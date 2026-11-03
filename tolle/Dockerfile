# Home Assistant add-on image
ARG BUILD_FROM=ghcr.io/home-assistant/base-python:3.13-alpine3.23
FROM ${BUILD_FROM}

# OCR for scanned notes / images, PDF page rendering
# OCR for scanned notes and photos (PDF pages are rendered by the bundled pypdfium2)
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng

WORKDIR /app
COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app/ /app/
COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV TOLLE_DATA_DIR=/data \
    TOLLE_PORT=8099 \
    PYTHONUNBUFFERED=1

CMD [ "/run.sh" ]
