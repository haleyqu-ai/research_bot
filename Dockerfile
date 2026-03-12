FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY backend/ backend/
COPY frontend/ frontend/
COPY .env* ./

# Port (Railway sets $PORT automatically)
ENV PORT=8000
EXPOSE 8000

# Run FastAPI via uvicorn
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}
