# Atelier 911 — site statique servi par Nginx (Coolify)
# Étape 1 : assemblage des fichiers publics (exclut docs et fichiers de build)
FROM alpine:3.20 AS builder
WORKDIR /site
COPY . .
RUN rm -f Dockerfile nginx.conf .dockerignore README.md

# Étape 2 : runner léger
FROM nginx:1.27-alpine AS runner
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/site.conf
COPY --from=builder /site /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
