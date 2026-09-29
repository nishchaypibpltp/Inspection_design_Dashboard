# Inspection Tracker — Phase 1. Containerizable for the hosted-later path.
# Runtime needs: Postgres (DATABASE_URL) + a media store — either S3-compatible
# (MEDIA_BACKEND=s3 with S3_ENDPOINT/S3_BUCKET) or GCS (MEDIA_BACKEND=gcs with
# GCS_BUCKET, credentials from the runtime service account via ADC).
# Deps are pure JS; `zip` is the only OS package the evidence bundle needs.
FROM node:22-alpine
RUN apk add --no-cache zip
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
COPY lib ./lib
COPY public ./public
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "server.mjs"]
