FROM node:lts

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /home/node/app

COPY --chown=node:node package*.json ./

RUN npm install

COPY ./ ./

COPY ./compose/common/scripts/wait-for-it.sh /bin/wait-for-it.sh
RUN sed -i 's/\r$//g' /bin/wait-for-it.sh
RUN chmod +x /bin/wait-for-it.sh

COPY ./compose/local/server/entrypoint /entrypoint
RUN sed -i 's/\r$//g' /entrypoint
RUN chmod +x /entrypoint

COPY ./compose/local/server/start /start
RUN sed -i 's/\r$//g' /start
RUN chmod +x /start

WORKDIR /home/node/app/server

ENTRYPOINT ["/entrypoint"]
