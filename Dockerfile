FROM node:lts

# Install Python, FFmpeg, Aubio and PySceneDetect
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg aubio-tools && \
    pip3 install --no-cache-dir scenedetect[opencv] && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js", "server"]
