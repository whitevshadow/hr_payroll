@echo off
set PATH=C:\Program Files\Docker\Docker\resources\bin;%PATH%
docker run --rm -v "d:\hr_payroll-develop__anish\frontend:/app" -w /app node:20-alpine sh -c "npm install --legacy-peer-deps && npm run build"
