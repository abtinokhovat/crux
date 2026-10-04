# adr share server — meeting notes and team review for ADRs.
# docker build -t adr-share . && docker run -p 8080:8080 -v adr-data:/data \
#   -e ADR_TOKENS="you:long-random-token" -e ADR_PASSCODE="team-secret" \
#   -e ADR_PUBLIC_URL="https://adr.example.com" adr-share
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY bin ./bin
COPY src ./src
COPY web ./web
COPY templates ./templates
COPY skills/answer-me-with-html/scripts ./skills/answer-me-with-html/scripts
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 ADR_DATA=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "bin/adr.mjs", "server"]
