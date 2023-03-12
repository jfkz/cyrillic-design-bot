FROM node:16-alpine

RUN mkdir /app

COPY ./package*.json /app
COPY ./locales /app/locales
COPY ./index.js /app/index.js

WORKDIR /app
RUN npm ci

ENV HOST=0.0.0.0

CMD ["npm", "start"]
