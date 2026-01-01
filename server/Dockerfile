FROM node:20.19.6-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for tsx and drizzle-kit)
RUN npm install

# Copy source files
COPY . .

# Generate Drizzle types (needed for TypeScript)
RUN npm run db:generate

# Run worker only (no build needed, runs TypeScript directly with tsx)
CMD ["npm", "run", "worker"]