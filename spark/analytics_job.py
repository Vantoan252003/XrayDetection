"""
Spark Analytics Job — Batch processing for XRay scan data.

Reads from PostgreSQL, performs aggregations, outputs to MinIO as Parquet.
Run: spark-submit --master spark://spark-master:7077 analytics_job.py
"""
import os
import json
from datetime import datetime, timedelta
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.window import Window

# Configuration
POSTGRES_URL = "jdbc:postgresql://postgres:5432/xraydb"
POSTGRES_PROPS = {
    "user": os.getenv("POSTGRES_USER", "xray"),
    "password": os.getenv("POSTGRES_PASSWORD", "secret"),
    "driver": "org.postgresql.Driver",
}

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET = os.getenv("MINIO_SECRET_KEY", "minioadmin")


def create_spark_session():
    """Create Spark session with S3A (MinIO) and PostgreSQL support."""
    return (
        SparkSession.builder
        .appName("XRay-Analytics-Batch")
        .config("spark.jars.packages",
                "org.postgresql:postgresql:42.7.1,"
                "org.apache.hadoop:hadoop-aws:3.3.4,"
                "com.amazonaws:aws-java-sdk-bundle:1.12.262")
        .config("spark.hadoop.fs.s3a.endpoint", MINIO_ENDPOINT)
        .config("spark.hadoop.fs.s3a.access.key", MINIO_ACCESS)
        .config("spark.hadoop.fs.s3a.secret.key", MINIO_SECRET)
        .config("spark.hadoop.fs.s3a.path.style.access", "true")
        .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem")
        .config("spark.hadoop.fs.s3a.aws.credentials.provider", "org.apache.hadoop.fs.s3a.SimpleAWSCredentialsProvider")
        .config("spark.hadoop.fs.s3a.connection.timeout", "60000")
        .config("spark.hadoop.fs.s3a.connection.establish.timeout", "30000")
        .config("spark.hadoop.fs.s3a.threads.keepalivetime", "60")
        .config("spark.hadoop.fs.s3a.multipart.purge.age", "86400")
        .config("spark.hadoop.fs.s3a.connection.ttl", "300000")
        .config("spark.hadoop.fs.s3a.assumed.role.session.duration", "1800")
        .config("spark.hadoop.fs.s3a.retry.interval", "500")
        .config("spark.hadoop.fs.s3a.retry.throttle.interval", "100")
        .config("spark.sql.adaptive.enabled", "true")
        .getOrCreate()
    )


def load_scans(spark):
    """Load scans table from PostgreSQL."""
    return spark.read.jdbc(
        url=POSTGRES_URL,
        table="scans",
        properties=POSTGRES_PROPS,
    )


def daily_summary(df_scans):
    """Aggregate daily scan statistics."""
    return (
        df_scans
        .withColumn("scan_date", F.to_date("created_at"))
        .groupBy("scan_date")
        .agg(
            F.count("*").alias("total_scans"),
            F.sum(F.when(F.col("is_normal") == True, 1).otherwise(0)).alias("normal_scans"),
            F.sum(F.when(F.col("is_normal") == False, 1).otherwise(0)).alias("abnormal_scans"),
            F.avg("processing_time_ms").alias("avg_processing_ms"),
            F.min("processing_time_ms").alias("min_processing_ms"),
            F.max("processing_time_ms").alias("max_processing_ms"),
            F.countDistinct("patient_id").alias("unique_patients"),
            F.countDistinct("top_disease").alias("unique_diseases"),
        )
        .orderBy("scan_date")
    )


def disease_frequency(df_scans):
    """Count disease occurrences and percentages."""
    total = df_scans.count()
    return (
        df_scans
        .filter(F.col("top_disease").isNotNull())
        .groupBy("top_disease")
        .agg(
            F.count("*").alias("count"),
            (F.count("*") / total * 100).alias("percentage"),
            F.avg("processing_time_ms").alias("avg_processing_ms"),
        )
        .orderBy(F.desc("count"))
    )


def hourly_pattern(df_scans):
    """Analyze scan patterns by hour of day."""
    return (
        df_scans
        .withColumn("hour", F.hour("created_at"))
        .groupBy("hour")
        .agg(
            F.count("*").alias("total_scans"),
            F.avg("processing_time_ms").alias("avg_processing_ms"),
        )
        .orderBy("hour")
    )


def disease_trend(df_scans):
    """Weekly disease trend analysis."""
    return (
        df_scans
        .filter(F.col("top_disease").isNotNull())
        .withColumn("week", F.weekofyear("created_at"))
        .withColumn("year", F.year("created_at"))
        .groupBy("year", "week", "top_disease")
        .agg(F.count("*").alias("count"))
        .orderBy("year", "week", F.desc("count"))
    )


def source_analysis(df_scans):
    """Analyze scan sources."""
    return (
        df_scans
        .groupBy("source")
        .agg(
            F.count("*").alias("total_scans"),
            F.avg("processing_time_ms").alias("avg_processing_ms"),
            F.countDistinct("patient_id").alias("unique_patients"),
        )
        .orderBy(F.desc("total_scans"))
    )


def processing_time_distribution(df_scans):
    """Bucket processing times into ranges."""
    return (
        df_scans
        .filter(F.col("processing_time_ms") > 0)
        .withColumn(
            "time_bucket",
            F.when(F.col("processing_time_ms") < 500, "0-500ms")
            .when(F.col("processing_time_ms") < 1000, "500ms-1s")
            .when(F.col("processing_time_ms") < 2000, "1s-2s")
            .when(F.col("processing_time_ms") < 5000, "2s-5s")
            .otherwise("5s+")
        )
        .groupBy("time_bucket")
        .agg(F.count("*").alias("count"))
        .orderBy("time_bucket")
    )


def main():
    """Run all analytics jobs."""
    print("=" * 60)
    print("XRay Analytics Batch Job")
    print(f"Started at: {datetime.now()}")
    print("=" * 60)

    spark = create_spark_session()

    try:
        # Load data
        df_scans = load_scans(spark)
        scan_count = df_scans.count()
        print(f"\nLoaded {scan_count} scans from PostgreSQL")

        if scan_count == 0:
            print("No data to process. Exiting.")
            return

        # Cache for reuse
        df_scans.cache()

        output_base = "s3a://xray-data/spark-output"
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # 1. Daily summary
        print("\n[1/6] Computing daily summary...")
        ds = daily_summary(df_scans)
        ds.write.mode("overwrite").parquet(f"{output_base}/daily_summary/{timestamp}")
        ds.show(10)

        # 2. Disease frequency
        print("\n[2/6] Computing disease frequency...")
        df = disease_frequency(df_scans)
        df.write.mode("overwrite").parquet(f"{output_base}/disease_frequency/{timestamp}")
        df.show(10)

        # 3. Hourly pattern
        print("\n[3/6] Computing hourly patterns...")
        hp = hourly_pattern(df_scans)
        hp.write.mode("overwrite").parquet(f"{output_base}/hourly_pattern/{timestamp}")
        hp.show(24)

        # 4. Disease trend
        print("\n[4/6] Computing disease trends...")
        dt = disease_trend(df_scans)
        dt.write.mode("overwrite").parquet(f"{output_base}/disease_trend/{timestamp}")
        dt.show(10)

        # 5. Source analysis
        print("\n[5/6] Computing source analysis...")
        sa = source_analysis(df_scans)
        sa.write.mode("overwrite").parquet(f"{output_base}/source_analysis/{timestamp}")
        sa.show()

        # 6. Processing time distribution
        print("\n[6/6] Computing processing time distribution...")
        ptd = processing_time_distribution(df_scans)
        ptd.write.mode("overwrite").parquet(f"{output_base}/processing_time/{timestamp}")
        ptd.show()

        print(f"\nAll reports written to {output_base}/")
        print(f"Completed at: {datetime.now()}")

    finally:
        spark.stop()


if __name__ == "__main__":
    main()
