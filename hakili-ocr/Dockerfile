# syntax=docker/dockerfile:1
FROM node:24.14-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite fige VITE_* dans le bundle au build (pas au runtime) — passées ici en
# build args par docker-compose.yml, à partir du .env racine.
ARG VITE_API_BASE_URL
ARG VITE_APP_API_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_API_KEY=$VITE_APP_API_KEY

RUN npm run build


FROM nginx:1.27-alpine

RUN addgroup -g 1000 appuser \
    && adduser -D -u 1000 -G appuser appuser

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# nginx doit pouvoir écrire son pid/cache/logs même en non-root
RUN chown -R appuser:appuser /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d \
    && touch /var/run/nginx.pid \
    && chown appuser:appuser /var/run/nginx.pid

USER appuser

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
