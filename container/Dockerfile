FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json ./package.json
COPY --chown=node:node lib/api.js lib/auth.js lib/helpers.js ./lib/
COPY --chown=node:node weekly-discover.mjs scheduler.mjs ./

USER node
CMD ["node", "scheduler.mjs"]
