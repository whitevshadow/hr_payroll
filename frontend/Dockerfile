# ---- Stage 1: build the React app ----
FROM node:20-alpine AS builder
WORKDIR /app

# Cache npm install layer separately.
COPY package.json ./
RUN npm install --legacy-peer-deps

# Bake VITE_API_BASE at build time. Override with --build-arg if needed.
ARG VITE_API_BASE=http://localhost:8000/api/v1
ENV VITE_API_BASE=$VITE_API_BASE

COPY . .
RUN npm run build

# ---- Stage 2: serve with nginx ----
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
