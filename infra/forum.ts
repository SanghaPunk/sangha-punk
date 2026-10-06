/// <reference path="../.sst/platform/config.d.ts" />

const FORUM_DOMAIN = "forum.sanghapunk.com";

export function createForum() {
  const adminEmail = new sst.Secret("ForumAdminEmail");

  const vpc = aws.ec2.getVpcOutput({ default: true });
  const subnets = aws.ec2.getSubnetsOutput({
    filters: [{ name: "vpc-id", values: [vpc.id] }],
  });

  const ami = aws.ec2.getAmiOutput({
    owners: ["099720109477"],
    mostRecent: true,
    filters: [
      {
        name: "name",
        values: ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"],
      },
    ],
  });

  const securityGroup = new aws.ec2.SecurityGroup("ForumSecurityGroup", {
    vpcId: vpc.id,
    description: "Discourse forum - HTTP/HTTPS only",
    ingress: [
      { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
      { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
    ],
    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
  });

  const role = new aws.iam.Role("ForumRole", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com",
    }),
  });

  new aws.iam.RolePolicyAttachment("ForumSsmPolicy", {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  });

  const instanceProfile = new aws.iam.InstanceProfile("ForumInstanceProfile", {
    role: role.name,
  });

  const region = aws.getRegionOutput().name;

  const sesIdentity = new aws.sesv2.EmailIdentity("ForumSesIdentity", {
    emailIdentity: FORUM_DOMAIN,
    dkimSigningAttributes: { nextSigningKeyLength: "RSA_2048_BIT" },
  });

  const smtpUser = new aws.iam.User("ForumSmtpUser");

  new aws.iam.UserPolicy("ForumSmtpUserPolicy", {
    user: smtpUser.name,
    policy: aws.iam.getPolicyDocumentOutput({
      statements: [
        {
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: [sesIdentity.arn],
        },
      ],
    }).json,
  });

  const smtpKey = new aws.iam.AccessKey("ForumSmtpAccessKey", {
    user: smtpUser.name,
  });

  const smtpUserParam = new aws.ssm.Parameter("ForumSmtpUserParam", {
    name: `/sangha-punk/${$app.stage}/forum/smtp-user`,
    type: "SecureString",
    value: smtpKey.id,
  });

  const smtpPasswordParam = new aws.ssm.Parameter("ForumSmtpPasswordParam", {
    name: `/sangha-punk/${$app.stage}/forum/smtp-password`,
    type: "SecureString",
    value: smtpKey.sesSmtpPasswordV4,
  });

  new aws.iam.RolePolicy("ForumReadSmtpParams", {
    role: role.name,
    policy: aws.iam.getPolicyDocumentOutput({
      statements: [
        {
          actions: ["ssm:GetParameter"],
          resources: [smtpUserParam.arn, smtpPasswordParam.arn],
        },
      ],
    }).json,
  });

  const userData = $interpolate`#!/bin/bash
set -euxo pipefail

# 1 GB RAM is not enough to bootstrap Discourse without swap
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update
apt-get install -y git docker.io
snap install aws-cli --classic
systemctl enable --now docker

SMTP_USER=$(aws ssm get-parameter --region ${region} --with-decryption \\
  --name ${smtpUserParam.name} --query Parameter.Value --output text)
SMTP_PASSWORD=$(aws ssm get-parameter --region ${region} --with-decryption \\
  --name ${smtpPasswordParam.name} --query Parameter.Value --output text)

mkdir -p /var/discourse
git clone https://github.com/discourse/discourse_docker.git /var/discourse
cd /var/discourse
cp samples/standalone.yml containers/app.yml

sed -i 's|^  DISCOURSE_HOSTNAME:.*|  DISCOURSE_HOSTNAME: "${FORUM_DOMAIN}"|' containers/app.yml
sed -i 's|^  DISCOURSE_DEVELOPER_EMAILS:.*|  DISCOURSE_DEVELOPER_EMAILS: "${adminEmail.value}"|' containers/app.yml
sed -i 's|^  DISCOURSE_SMTP_ADDRESS:.*|  DISCOURSE_SMTP_ADDRESS: email-smtp.${region}.amazonaws.com|' containers/app.yml
sed -i 's|^  #DISCOURSE_SMTP_PORT:.*|  DISCOURSE_SMTP_PORT: 587|' containers/app.yml
sed -i "s|^  DISCOURSE_SMTP_USER_NAME:.*|  DISCOURSE_SMTP_USER_NAME: $SMTP_USER|" containers/app.yml
sed -i "s|^  DISCOURSE_SMTP_PASSWORD:.*|  DISCOURSE_SMTP_PASSWORD: \\"$SMTP_PASSWORD\\"|" containers/app.yml
sed -i 's|^  #DISCOURSE_NOTIFICATION_EMAIL:.*|  DISCOURSE_NOTIFICATION_EMAIL: noreply@${FORUM_DOMAIN}|' containers/app.yml
sed -i 's|^  ## Uncomment these two lines.*||; s|^  #- "templates/web.ssl.template.yml"|  - "templates/web.ssl.template.yml"|; s|^  #- "templates/web.letsencrypt.ssl.template.yml"|  - "templates/web.letsencrypt.ssl.template.yml"|' containers/app.yml
sed -i '/^  DISCOURSE_HOSTNAME:/a\\  LETSENCRYPT_ACCOUNT_EMAIL: "${adminEmail.value}"' containers/app.yml

./launcher bootstrap app
./launcher start app
`;

  const instance = new aws.ec2.Instance(
    "ForumInstance",
    {
      ami: ami.id,
      instanceType: "t4g.micro",
      subnetId: subnets.ids[0],
      vpcSecurityGroupIds: [securityGroup.id],
      iamInstanceProfile: instanceProfile.name,
      associatePublicIpAddress: true,
      userData,
      rootBlockDevice: {
        volumeType: "gp3",
        volumeSize: 20,
        encrypted: true,
      },
      metadataOptions: { httpTokens: "required" },
      tags: { Name: `sangha-punk-forum-${$app.stage}` },
    },
    { ignoreChanges: ["ami", "userData"] }
  );

  const eip = new aws.ec2.Eip("ForumEip", {
    instance: instance.id,
    domain: "vpc",
  });

  return {
    forumDomain: FORUM_DOMAIN,
    forumIp: eip.publicIp,
    forumDkimCnameRecords: sesIdentity.dkimSigningAttributes.apply((attrs) =>
      (attrs.tokens ?? []).map((token) => ({
        name: `${token}._domainkey.${FORUM_DOMAIN}`,
        value: `${token}.dkim.amazonses.com`,
      }))
    ),
  };
}
