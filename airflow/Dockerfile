FROM apache/airflow:2.8.0

# Switch to root user to install any system packages if needed
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Switch back to airflow user to install python libraries
USER airflow
RUN pip install --no-cache-dir \
    kaggle \
    boto3 \
    requests \
    mlflow \
    psycopg2-binary
