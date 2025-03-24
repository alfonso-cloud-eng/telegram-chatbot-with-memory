# Dockerfile
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if present)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your code
COPY . .

# Expose the app port (3000 by default)
EXPOSE 5000

# Start the app
CMD [ "npm", "start" ]
