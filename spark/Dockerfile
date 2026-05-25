FROM apache/spark:python3

USER root

# Install Python dependencies
RUN pip install --no-cache-dir \
    boto3 \
    psycopg2-binary \
    pandas \
    pyarrow

# Copy application files
COPY . /opt/spark-apps/

USER spark
