FROM python:3.11-slim

WORKDIR /app

# Install deps first (layer-cached until requirements.txt changes)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the full repo (backend + frontend + config)
COPY . .

# SQLite lives on a mounted volume in prod; /data is the mount point.
# Override with DB_PATH env var — Railway sets this via the volume config.
ENV DB_PATH=/data/eduai.db

# PORT is injected by Railway at runtime
EXPOSE 8001
