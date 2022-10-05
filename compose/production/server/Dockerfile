FROM node:lts

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /home/node/app

COPY --chown=node:node package*.json ./

RUN npm ci --only=production

COPY --chown=node:node ./ ./

COPY --chown=node:node ./compose/common/scripts/wait-for-it.sh /bin/wait-for-it.sh
RUN sed -i 's/\r$//g' /bin/wait-for-it.sh
RUN chmod +x /bin/wait-for-it.sh

COPY --chown=node:node ./compose/production/server/entrypoint /entrypoint
RUN sed -i 's/\r$//g' /entrypoint
RUN chmod +x /entrypoint

COPY --chown=node:node ./compose/production/server/start /start
RUN sed -i 's/\r$//g' /start
RUN chmod +x /start

WORKDIR /home/node/app/server

USER node

ENTRYPOINT ["/entrypoint"]
