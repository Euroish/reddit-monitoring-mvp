FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
COPY deploy/apify-relay.mjs /apify-relay.mjs
USER 10002:10002
CMD ["node", "--use-env-proxy", "/apify-relay.mjs"]
