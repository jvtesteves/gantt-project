# Use a imagem oficial do Node.js como base
FROM node:20-alpine

# Defina o diretório de trabalho dentro do contêiner
WORKDIR /app

# Copie os arquivos package.json e package-lock.json para instalar as dependências
COPY package*.json ./

# Instale as dependências do projeto
RUN npm install

# Copie o restante do código da aplicação para o contêiner
COPY . .

# Exponha a porta em que o aplicativo Node.js será executado
EXPOSE 3001

# Comando para iniciar o aplicativo
CMD ["node", "server.js"]
