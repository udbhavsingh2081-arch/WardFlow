# WardFlow — PieHost / PieApp Production Deployment Guide

This guide details the step-by-step procedures to deploy the **WardFlow** hospital operations management platform to **PieHost / PieApp** (or compatible Node.js cloud hosting environments).

---

## 1. Architectural Overview & Hosting Requirements

WardFlow is a full-stack Node.js enterprise application built with Express 5, EJS, and MongoDB:

| Component | Specification | Deployment Note |
| :--- | :--- | :--- |
| **Runtime** | Node.js `>=20.0.0` (LTS Recommended), npm `>=10.0.0` | Specified in `package.json` under `"engines"`. |
| **Web Server** | Express 5.3+ binding to `0.0.0.0` | Listens on `process.env.PORT` assigned by host (fallback `3000`). |
| **Reverse Proxy** | Nginx / Cloudflare / PieHost Gateway | Configured with `TRUST_PROXY=1` for secure cookies & rate limiting over HTTPS. |
| **Database** | MongoDB 6.0+ (MongoDB Atlas Recommended) | Requires valid SRV connection string with network whitelist. |
| **Sessions** | MongoDB-backed session store (`connect-mongo`) | Persistent across server restarts; does not rely on MemoryStore. |
| **Background Cron** | SLA Escalation Worker (`node-cron`) | Runs in-process every 15 mins by default; can run standalone. |
| **File Storage** | Multer (`uploads/` directory) | Stored on filesystem; ephemeral containers require persistent volume. |
| **AI Integration** | Google Gemini API or OpenAI API | Optional; fails gracefully (HTTP 503) if unconfigured or quota exceeded. |

---

## 2. Prerequisites

Before beginning the deployment, ensure you have:
1. **GitHub Repository:** Pushed code to `https://github.com/udbhavsingh2081-arch/WardFlow`.
2. **MongoDB Database:** A running MongoDB instance. **MongoDB Atlas** (Free M0 or Dedicated) is strongly recommended for cloud hosting.
3. **PieHost Account:** Access to your PieHost / PieApp control panel or cPanel interface.
4. **AI Key (Optional):** Google Gemini API Key (`GEMINI_API_KEY`) or OpenAI Key (`OPENAI_API_KEY`).
5. **SMTP Relay (Optional):** Gmail App Password or custom SMTP relay for email notifications.

---

## 3. Step 1: Configure MongoDB Atlas Database

PieHost does not provide a managed MongoDB cluster locally on basic containers, so a remote MongoDB database (such as MongoDB Atlas) is required:

1. Log into your [MongoDB Atlas](https://cloud.mongodb.com/) account and create a cluster (M0 Free tier is sufficient to start).
2. **Create a Database User:**
   - Go to **Database Access** > **Add New Database User**.
   - Authentication Method: **Password**.
   - Assign user privileges: **Read and write to any database**.
   - Save the username and password securely (do not use `@`, `/`, or special URL characters in password without percent-encoding).
3. **Configure Network Access (Crucial):**
   - Go to **Network Access** > **Add IP Address**.
   - Choose **Allow Access from Anywhere** (`0.0.0.0/0`). Cloud container platforms (including PieHost/PieApp) allocate dynamic outbound IPs that change across deployments.
4. **Retrieve Connection String:**
   - Click **Connect** > **Drivers** (Node.js).
   - Copy the SRV URI:
     ```text
     mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/wardflow?retryWrites=true&w=majority
     ```
   - Replace `<username>` and `<password>` with your database user credentials.

---

## 4. Step 2: Environment Variables Reference

Configure these environment variables in your **PieHost / PieApp dashboard** (under Environment Variables / Application Settings):

| Variable | Required? | Default / Example | Purpose |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | **Yes** | `production` | Enables production optimizations and secure cookie flags. |
| `PORT` | Auto | `3000` | Port injected automatically by PieHost/PieApp. |
| `HOST` | Recommended | `0.0.0.0` | Binds server to all interfaces for container ingress. |
| `TRUST_PROXY` | **Yes** | `1` | Enables reverse-proxy protocol detection (`req.secure`) for HTTPS. |
| `MONGODB_URI` | **Yes** | `mongodb+srv://user:pass@cluster.mongodb.net/wardflow?retryWrites=true&w=majority` | Connection string to MongoDB database and session store. |
| `SESSION_SECRET` | **Yes** | `[64+ char random string]` | Secret key used to sign session cookies. |
| `SESSION_MAX_AGE` | Optional | `86400000` | Session lifetime in ms (default: 24 hours). |
| `APP_NAME` | Optional | `WardFlow` | Display name for application headers and emails. |
| `APP_URL` | **Yes** | `https://your-domain.piehost.com` | Public domain URL (used for QR code target links & emails). |
| `APP_BASE_URL` | Optional | `https://your-domain.piehost.com` | Alias for `APP_URL`. |
| `TIMEZONE` | Optional | `Asia/Kolkata` | Timezone for SLA schedules and timestamp displays. |
| `RUN_ESCALATION_WORKER` | Optional | `true` | `true` runs cron in web process. Set `false` if using dedicated worker. |
| `GEMINI_API_KEY` | Optional | `AIzaSy...` | Google Gemini API key for smart ticket triage. |
| `GEMINI_MODEL` | Optional | `gemini-1.5-flash` | Gemini model name. |
| `OPENAI_API_KEY` | Optional | `sk-...` | OpenAI key (alternative to Gemini). |
| `OPENAI_MODEL` | Optional | `gpt-4o-mini` | OpenAI model name. |
| `EMAIL_HOST` | Optional | `smtp.gmail.com` | SMTP relay server hostname. |
| `EMAIL_PORT` | Optional | `587` | SMTP relay port (587 for STARTTLS). |
| `EMAIL_USER` | Optional | `notifications@hospital.org` | SMTP user / email address. |
| `EMAIL_PASS` | Optional | `[app password]` | SMTP password or app-specific token. |

> [!IMPORTANT]
> To generate a secure `SESSION_SECRET` in PowerShell or Bash, run:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## 5. Step 3: Deployment Walkthrough on PieHost / PieApp

### Deployment Mode A: PieApp Cloud / Container Deploy (Git-Based)

1. **Link GitHub Repository:**
   - In PieHost / PieApp, navigate to **Apps** > **Create New App** > **Deploy from GitHub**.
   - Select the repository: `udbhavsingh2081-arch/WardFlow`.
   - Branch: `main`.
2. **Build & Start Commands:**
   - **Node.js Version:** `20.x` (LTS)
   - **Build Command:** `npm install` (or `npm ci --omit=dev`)
   - **Start Command:** `node server.js` (or `npm start`)
3. **Configure Environment Variables:**
   - In the **Environment Variables** tab, input the key-value pairs listed in the table above (`NODE_ENV`, `MONGODB_URI`, `SESSION_SECRET`, `TRUST_PROXY`, `APP_URL`, etc.).
4. **Trigger Deployment:**
   - Click **Deploy Application**.
   - Monitor the deployment build log. The build will install dependencies and start `node server.js`.
5. **Verify Startup:**
   - Look for the console message:
     ```text
     MongoDB connected: cluster0-shard-00-00.abcde.mongodb.net
     [Escalation Worker] Started — running every 15 minutes
     WardFlow running at http://0.0.0.0:3000 [production]
     ```

---

### Deployment Mode B: PieHost cPanel / Node.js App Manager (Phusion Passenger)

If your PieHost hosting package uses cPanel with **Setup Node.js App**:

1. **Upload / Clone Code:**
   - Use Git Version Control in cPanel to clone `https://github.com/udbhavsingh2081-arch/WardFlow` into a directory (e.g., `~/wardflow`).
2. **Create Node.js Application:**
   - Open **Setup Node.js App** in cPanel.
   - Click **Create Application**.
   - **Node.js version:** Select `20.x` or latest LTS.
   - **Application mode:** Select `Production`.
   - **Application root:** `wardflow`
   - **Application startup file:** `server.js`
   - **Application URL:** Select your domain or subdomain.
3. **Configure Environment Variables:**
   - In the **Environment variables** section at the bottom, click **Add Variable** for each setting (`MONGODB_URI`, `SESSION_SECRET`, `TRUST_PROXY`, `NODE_ENV`, `APP_URL`).
4. **Install Dependencies:**
   - Click **Run NPM Install** button or run `npm install` via SSH terminal inside `~/wardflow`.
5. **Start / Restart Application:**
   - Click **Restart** in the Node.js selector.

---

## 6. Step 4: Database Seeding (First-Time Setup)

Once the application is connected to your remote MongoDB Atlas cluster, run the initial seed script to create default departments, SLA policies, and seed administrative accounts:

### Option A: From Local Machine (Recommended for Security)
Run the seed script from your local workstation pointing directly to your Atlas database:
```powershell
# Set your production Atlas connection string temporarily in your terminal session
$env:MONGODB_URI="mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/wardflow?retryWrites=true&w=majority"
node scripts/seed.js
```

### Option B: Via Host SSH / Web Console
```bash
MONGODB_URI="mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/wardflow?retryWrites=true&w=majority" node scripts/seed.js
```

**Seed Accounts Created:**
- **Hospital Administrator:** `admin@citycare.org` (Password: `password123`)
- **Operations Manager:** `manager@citycare.org` (Password: `password123`)
- **Biomedical Supervisor:** `biomed.sup@citycare.org` (Password: `password123`)
- **Support Staff:** `tech1@citycare.org` (Password: `password123`)
- **Reporter / Nurse:** `nurse.sarah@citycare.org` (Password: `password123`)

> [!WARNING]
> Immediately upon logging in to the production deployment, navigate to **Profile** (`/auth/profile`) or **Admin > Users** (`/admin/users`) and change the default passwords for all seeded accounts.

---

## 7. Step 5: Background Workers & Escalation

### In-Process Scheduler (Default)
When `RUN_ESCALATION_WORKER=true` (the default), `server.js` runs a non-blocking `node-cron` task every 15 minutes checking for SLA breaches and missed deadlines. This is suitable for standard single-instance hosting.

### Dedicated Worker Process (For Scaled / Multi-Container Environments)
If your PieHost environment runs multiple web instances behind a load balancer, having every web instance run the cron will duplicate escalation notifications. To prevent this:
1. Set `RUN_ESCALATION_WORKER=false` on all web application instances.
2. In PieHost Background Tasks / Worker Dyno, run the standalone worker:
   ```bash
   node jobs/escalationWorker.js
   ```
   The standalone worker connects to the database, initiates the schedule, and runs an immediate check on boot with graceful termination handling.

---

## 8. Step 6: File Storage Considerations

- **Current Implementation:** File attachments submitted with tickets are stored on disk in the `uploads/` directory via Multer.
- **Ephemeral Containers:** If PieApp runs as an ephemeral container (where files on local disk are wiped during app restarts or re-deploys), attachments will not persist unless a **Persistent Disk / Volume** is mounted to the `/uploads` directory in the container settings.
- **Persistent Hosting (cPanel / VPS):** On standard cPanel or VPS plans, files written to `uploads/` are durable on the filesystem.

---

## 9. Step 7: Post-Deployment Smoke Tests

Verify the live deployment systematically:

1. **Safe Health Check:**
   - Visit: `https://your-domain.piehost.com/health` (or `/api/health`).
   - Expected Response: `HTTP 200 OK`
     ```json
     {
       "status": "healthy",
       "timestamp": "2026-10-25T07:55:00.000Z",
       "uptime": 120,
       "database": "connected"
     }
     ```
2. **Authentication & Session Persistence:**
   - Navigate to `/auth/login`.
   - Log in as `admin@citycare.org`.
   - Refresh the page and navigate to `/dashboard` to confirm session cookies persist properly over HTTPS.
3. **Ticket Lifecycle:**
   - Click **+ Report Issue** (`/tickets/new`).
   - Create a test ticket.
   - Verify it redirects to `/tickets/<id>` and shows up on `/tickets`.
4. **Analytics Dashboard:**
   - Log in as Operations Manager (`manager@citycare.org`).
   - Navigate to `/analytics`. Verify all 6 KPI tiles and bottleneck breakdown tables populate with real data.
5. **QR Code Generation & Mobile Reporting:**
   - Navigate to `/qr/assets`.
   - Open a registered QR asset, click **Preview Label**, and confirm the QR code renders cleanly.
   - Copy the public report URL (`/qr/report?token=...`) into an incognito tab or mobile phone to verify issue reporting works without requiring a login.

---

## 10. Troubleshooting & Common Issues

### 1. `MongooseServerSelectionError: connect ETIMEDOUT`
- **Cause:** MongoDB Atlas is blocking incoming traffic from PieHost.
- **Solution:** In MongoDB Atlas, go to **Network Access** and verify that `0.0.0.0/0` (Allow Access from Anywhere) is active.

### 2. Session Logouts or "Please log in to continue" on every click
- **Cause:** Secure cookie rejection. When running behind an HTTPS reverse proxy (like PieHost), Express must know the proxy is terminating TLS.
- **Solution:** Ensure `TRUST_PROXY=1` is set in your hosting environment variables.

### 3. `AI service unavailable (503)`
- **Cause:** Neither `GEMINI_API_KEY` nor `OPENAI_API_KEY` is set, or the API key has exceeded its rate limit.
- **Solution:** Provide a valid `GEMINI_API_KEY` or `OPENAI_API_KEY`. WardFlow handles this gracefully so the rest of the application functions normally even when AI is unavailable.

### 4. `Error: EACCES: permission denied, mkdir '.../uploads'`
- **Cause:** The Node.js process does not have write permissions to create or write to the `uploads/` directory.
- **Solution:** On cPanel / Linux hosting, verify directory permissions:
  ```bash
  chmod 755 uploads
  ```
