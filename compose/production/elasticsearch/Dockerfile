FROM elasticsearch:8.4.2

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /usr/share/elasticsearch

COPY --chown=elasticsearch:elasticsearch ./elasticsearch/stopwords_pt.txt config/
