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

# Set working directory to the backend package so uvicorn can find app.main
# without needing a cd in the start command (avoids shell quoting issues with $PORT).
WORKDIR /app/backend

# PORT is injected by Railway at runtime.
# Shell-form CMD (no brackets) runs via /bin/sh -c, so $PORT is expanded.
EXPOSE 8001
CMD ["/bin/sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
