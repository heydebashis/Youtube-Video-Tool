# Use the official slim Node image
FROM node:18-slim

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# install dependencies
COPY package*.json ./
RUN npm install --production

# copy app code
COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
