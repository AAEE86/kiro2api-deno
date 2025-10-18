FROM denoland/deno:alpine-2.1.2

# Set working directory
WORKDIR /app

# Copy application files
COPY . .

# Cache dependencies
RUN deno cache main.ts

# Expose port
EXPOSE 8080

# Run the application
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
