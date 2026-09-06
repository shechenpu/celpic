FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production ADMIN_PORT=1018 IMAGE_PORT=23133 DUAL_PORTS=1 DATA_DIR=/data CELPIC_STORAGE_DIR=/data/images
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
RUN mkdir -p /data/images && chown -R node:node /data
USER node
EXPOSE 1018 23133
VOLUME ["/data"]
CMD ["node", "server.js"]


