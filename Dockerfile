FROM node:14-alpine

RUN apt-get update || : && apt-get install python -y

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . .
RUN npm install
RUN npm run build-prod
RUN chmod -R a+x /usr/src/app/linux
EXPOSE 4000
CMD node app.js
