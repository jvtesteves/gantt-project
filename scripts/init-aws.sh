#!/bin/bash

# 🏗️ Script de Inicialização AWS - Gantt Project
# Configura toda infraestrutura AWS automaticamente

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"; }
success() { echo -e "${GREEN}✅ $1${NC}"; }
warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# Verificar AWS CLI
if ! command -v aws &> /dev/null; then
    error "AWS CLI não encontrado. Instale: https://aws.amazon.com/cli/"
fi

# Verificar credenciais AWS
if ! aws sts get-caller-identity &> /dev/null; then
    error "Credenciais AWS não configuradas. Execute: aws configure"
fi

# Configurações
PROJECT_NAME="gantt-project"
REGION="us-east-1"
ENVIRONMENT="production"

# Gerar nomes únicos
TIMESTAMP=$(date +%Y%m%d%H%M)
S3_BUCKET="${PROJECT_NAME}-frontend-${TIMESTAMP}"
RDS_IDENTIFIER="${PROJECT_NAME}-db-${TIMESTAMP}"
EC2_KEY_NAME="${PROJECT_NAME}-key-${TIMESTAMP}"

log "🚀 Inicializando infraestrutura AWS para ${PROJECT_NAME}"
log "📍 Região: $REGION"
log "🏷️  Timestamp: $TIMESTAMP"

# 1. CRIAR KEY PAIR
log "🔑 Criando Key Pair..."
aws ec2 create-key-pair \
    --key-name "$EC2_KEY_NAME" \
    --query 'KeyMaterial' \
    --output text \
    --region "$REGION" > "${EC2_KEY_NAME}.pem"

chmod 400 "${EC2_KEY_NAME}.pem"
success "Key Pair criado: ${EC2_KEY_NAME}.pem"

# 2. CRIAR SECURITY GROUP
log "🛡️ Criando Security Group..."
SG_ID=$(aws ec2 create-security-group \
    --group-name "${PROJECT_NAME}-sg-${TIMESTAMP}" \
    --description "Security group for Gantt Project" \
    --region "$REGION" \
    --query 'GroupId' \
    --output text)

# Regras do Security Group
aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 22 \
    --cidr 0.0.0.0/0 \
    --region "$REGION"

aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 3001 \
    --cidr 0.0.0.0/0 \
    --region "$REGION"

aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 5432 \
    --cidr 0.0.0.0/0 \
    --region "$REGION"

success "Security Group criado: $SG_ID"

# 3. CRIAR RDS INSTANCE
log "🗄️ Criando instância RDS..."
RDS_PASSWORD="GanttDB$(openssl rand -base64 12 | tr -d '=+/')"

aws rds create-db-instance \
    --db-instance-identifier "$RDS_IDENTIFIER" \
    --db-instance-class db.t3.micro \
    --engine postgres \
    --master-username postgres \
    --master-user-password "$RDS_PASSWORD" \
    --allocated-storage 20 \
    --vpc-security-group-ids "$SG_ID" \
    --publicly-accessible \
    --region "$REGION"

success "RDS criado: $RDS_IDENTIFIER (aguardando disponibilidade...)"

# 4. CRIAR S3 BUCKET
log "🪣 Criando bucket S3..."
aws s3 mb "s3://$S3_BUCKET" --region "$REGION"

# Configurar website hosting
aws s3 website "s3://$S3_BUCKET" \
    --index-document index.html \
    --error-document index.html

# Política do bucket
cat > bucket-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::$S3_BUCKET/*"
        }
    ]
}
EOF

aws s3api put-bucket-policy \
    --bucket "$S3_BUCKET" \
    --policy file://bucket-policy.json

rm bucket-policy.json
success "S3 bucket criado: $S3_BUCKET"

# 5. CRIAR EC2 INSTANCE
log "🖥️ Criando instância EC2..."

# User data script
cat > user-data.sh << 'EOF'
#!/bin/bash
yum update -y
yum install -y nodejs npm git postgresql15

# Configurar usuário
cd /home/ec2-user
git clone https://github.com/seu-usuario/gantt-project.git || echo "Clone manual necessário"
chown -R ec2-user:ec2-user /home/ec2-user/gantt-project
EOF

INSTANCE_ID=$(aws ec2 run-instances \
    --image-id ami-0182f373e66f89c85 \
    --count 1 \
    --instance-type t2.micro \
    --key-name "$EC2_KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --user-data file://user-data.sh \
    --region "$REGION" \
    --query 'Instances[0].InstanceId' \
    --output text)

rm user-data.sh
success "EC2 criado: $INSTANCE_ID (aguardando inicialização...)"

# 6. AGUARDAR RDS E EC2
log "⏳ Aguardando recursos ficarem disponíveis..."

# Aguardar EC2
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
EC2_IP=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text \
    --region "$REGION")

success "EC2 disponível: $EC2_IP"

# Aguardar RDS (pode demorar 10-15 min)
log "⏳ Aguardando RDS (pode demorar até 15 minutos)..."
aws rds wait db-instance-available --db-instance-identifier "$RDS_IDENTIFIER" --region "$REGION"

RDS_ENDPOINT=$(aws rds describe-db-instances \
    --db-instance-identifier "$RDS_IDENTIFIER" \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text \
    --region "$REGION")

success "RDS disponível: $RDS_ENDPOINT"

# 7. GERAR ARQUIVO DE CONFIGURAÇÃO
log "📝 Gerando arquivo de configuração..."
cat > scripts/deploy.config << EOF
# Configurações geradas automaticamente - $TIMESTAMP

# EC2 (Backend)
EC2_HOST="$EC2_IP"
EC2_USER="ec2-user"
EC2_KEY_PATH="$PWD/${EC2_KEY_NAME}.pem"

# S3 (Frontend)
S3_BUCKET="$S3_BUCKET"
AWS_REGION="$REGION"

# RDS (Banco)
RDS_ENDPOINT="$RDS_ENDPOINT"
RDS_PORT="5432"
RDS_DB_NAME="gantt_project"
RDS_USERNAME="postgres"
RDS_PASSWORD="$RDS_PASSWORD"

# CloudFront (opcional - configure manualmente)
CLOUDFRONT_DISTRIBUTION_ID=""
CLOUDFRONT_DOMAIN=""
EOF

success "Configuração salva: scripts/deploy.config"

# 8. AGUARDAR EC2 FICAR ACESSÍVEL VIA SSH
log "⏳ Aguardando EC2 ficar acessível via SSH..."
for i in {1..30}; do
    if ssh -i "${EC2_KEY_NAME}.pem" -o ConnectTimeout=5 -o StrictHostKeyChecking=no ec2-user@"$EC2_IP" "echo 'SSH OK'" &>/dev/null; then
        success "SSH disponível no EC2"
        break
    fi
    [[ $i -eq 30 ]] && error "Timeout: EC2 não ficou acessível via SSH"
    sleep 10
done

# RELATÓRIO FINAL
echo ""
success "🎉 Infraestrutura AWS criada com sucesso!"
echo ""
echo "📊 RECURSOS CRIADOS:"
echo "  🖥️  EC2: $INSTANCE_ID ($EC2_IP)"
echo "  🗄️  RDS: $RDS_IDENTIFIER ($RDS_ENDPOINT)"
echo "  🪣 S3: $S3_BUCKET"
echo "  🔑 Key: ${EC2_KEY_NAME}.pem"
echo "  🛡️  SG: $SG_ID"
echo ""
echo "🔐 CREDENCIAIS:"
echo "  RDS Username: postgres"
echo "  RDS Password: $RDS_PASSWORD"
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo "  1. Configure seu repositório Git no EC2:"
echo "     ssh -i ${EC2_KEY_NAME}.pem ec2-user@$EC2_IP"
echo "     cd /home/ec2-user && git clone https://github.com/seu-usuario/gantt-project.git"
echo ""
echo "  2. Configure o banco de dados:"
echo "     ./scripts/setup-rds.sh"
echo ""
echo "  3. Faça o deploy:"
echo "     ./scripts/deploy.sh"
echo ""
echo "  4. Configure CloudFront (opcional) para HTTPS"
echo ""
warning "💰 LEMBRE-SE: Estes recursos podem gerar custos. Monitore seu billing!"
warning "🔒 SEGURANÇA: Considere restringir os Security Groups para seu IP apenas"