FROM python:3.11-slim
WORKDIR /app
COPY wardrivedb/ wardrivedb/
COPY static/ static/
COPY index.html server.py start.sh ./
RUN chmod +x start.sh
ENV PORT=8765
EXPOSE ${PORT}
CMD ["python3", "-m", "wardrivedb"]