FROM nikolaik/python-nodejs:python3.9-nodejs14-slim
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . .
RUN npm install
RUN npm run build-prod
RUN chmod -R a+x /usr/src/app/linux
EXPOSE 4000
CMD node app.js
