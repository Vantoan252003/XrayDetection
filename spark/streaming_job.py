"""
Spark Structured Streaming Job — Near-realtime analytics from Kafka.

Consumes scan-events topic, performs micro-batch aggregations.
Run: spark-submit --master spark://spark-master:7077 streaming_job.py
"""
import os
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, MapType, FloatType

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:29092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC_SCANS", "scan-events")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET = os.getenv("MINIO_SECRET_KEY", "minioadmin")


def create_spark_session():
    return (
        SparkSession.builder
        .appName("XRay-Streaming-Analytics")
        .config("spark.jars.packages",
                "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0,"
                "org.apache.hadoop:hadoop-aws:3.3.4,"
                "com.amazonaws:aws-java-sdk-bundle:1.12.262")
        .config("spark.hadoop.fs.s3a.endpoint", MINIO_ENDPOINT)
        .config("spark.hadoop.fs.s3a.access.key", MINIO_ACCESS)
        .config("spark.hadoop.fs.s3a.secret.key", MINIO_SECRET)
        .config("spark.hadoop.fs.s3a.path.style.access", "true")
        .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem")
        .config("spark.sql.streaming.checkpointLocation",
                "s3a://xray-data/spark-checkpoints/streaming")
        .getOrCreate()
    )


# Schema for Kafka event value
event_schema = StructType([
    StructField("event_type", StringType()),
    StructField("scan_id", StringType()),
    StructField("timestamp", StringType()),
    StructField("data", StringType()),  # JSON string
])


def main():
    print("Starting XRay Streaming Analytics...")
    spark = create_spark_session()

    # Read from Kafka
    df_raw = (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP)
        .option("subscribe", KAFKA_TOPIC)
        .option("startingOffsets", "latest")
        .load()
    )

    # Parse Kafka messages
    df_parsed = (
        df_raw
        .selectExpr("CAST(value AS STRING) as json_value", "timestamp as kafka_timestamp")
        .select(
            F.from_json("json_value", event_schema).alias("event"),
            "kafka_timestamp",
        )
        .select("event.*", "kafka_timestamp")
        .filter(F.col("event_type") == "scan.completed")
    )

    # Parse nested data JSON
    df_events = (
        df_parsed
        .withColumn("data_json", F.from_json("data", MapType(StringType(), StringType())))
        .withColumn("top_disease", F.col("data_json").getItem("top_disease"))
        .withColumn("is_normal", F.col("data_json").getItem("is_normal").cast("boolean"))
        .withColumn("processing_time_ms",
                     F.col("data_json").getItem("processing_time_ms").cast("integer"))
        .withColumn("source", F.col("data_json").getItem("source"))
    )

    # Windowed aggregation — 5 minute tumbling windows
    df_windowed = (
        df_events
        .withWatermark("kafka_timestamp", "10 minutes")
        .groupBy(
            F.window("kafka_timestamp", "5 minutes"),
        )
        .agg(
            F.count("*").alias("scan_count"),
            F.sum(F.when(F.col("is_normal") == True, 1).otherwise(0)).alias("normal_count"),
            F.sum(F.when(F.col("is_normal") == False, 1).otherwise(0)).alias("abnormal_count"),
            F.avg("processing_time_ms").alias("avg_processing_ms"),
        )
    )

    # Write to MinIO as Parquet (append mode)
    query = (
        df_windowed
        .select(
            F.col("window.start").alias("window_start"),
            F.col("window.end").alias("window_end"),
            "scan_count",
            "normal_count",
            "abnormal_count",
            "avg_processing_ms",
        )
        .writeStream
        .outputMode("update")
        .format("parquet")
        .option("path", "s3a://xray-data/spark-output/streaming_windows")
        .trigger(processingTime="30 seconds")
        .start()
    )

    print("Streaming query started. Waiting for termination...")
    query.awaitTermination()


if __name__ == "__main__":
    main()
