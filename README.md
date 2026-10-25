# WardFlow — Hospital Operations Issue-Resolution Platform

WardFlow is a multi-tenant hospital operations management web application built for Indian and international hospitals to report, assign, track, escalate, and verify the resolution of non-clinical operational issues across departments.

---

## Key Features

### 1. Complete Ticket Lifecycle & RBAC
- **Roles:** `reporter`, `staff`, `supervisor`, `operations_manager`, `hospital_admin`, `platform_admin`.
- **Status Workflow:** `open` &rarr; `assigned` &rarr; `in_progress` &rarr; `blocked` &rarr; `resolved` &rarr; `closed` (verified) / `reopened`.
- **Tenant Isolation:** Multi-hospital data partitioning enforced via session hospital ID across all database queries.
- **Audit Activity Trail:** Every assignment, status transition, priority change, and resolution is logged in `TicketActivity`.

### 2. QR-Based Issue Reporting
- **Register Physical Assets & Locations:** Non-clinical equipment (ventilators, wheelchairs, ECG machines) and facility rooms (ICU, male ward, generator room).
- **Cryptographically Secure Tokens:** QR codes contain a revocable, 256-bit unguessable URL token (`APP_BASE_URL/qr/report/:token`). Internal MongoDB ObjectIds and database secrets are never exposed in URLs.
- **Mobile-First Scan & Report:** Staff scan the QR sticker using their phone camera; hospital name, department, asset code, and physical location details are automatically prefilled.
- **Printable Labels & PNG Downloads:** Operations managers can preview, download PNG barcodes, or print adhesive equipment stickers with clean `@media print` styling.
- **Token Rotation & Retirement:** One-click token regeneration invalidates compromised or replaced physical stickers; retirement stops report acceptance immediately.
- **Abuse Prevention:** Rate-limited public submission endpoint preventing spam.

### 3. Escalation & Bottleneck Analytics
- **Cross-Department Operational Bottlenecks:** Real MongoDB data aggregation displaying ticket volume, active backlog, overdue counts, SLA breach rates, average assignment delay, and resolution velocity per department.
- **Category SLA Analysis:** High-resolution breakdown by category (electrical, plumbing, equipment, facilities, housekeeping) showing breach frequencies and average resolution hours.
- **Real-Time Escalation Monitoring:** Live table tracking all currently overdue tickets requiring immediate supervisor/manager intervention, including overdue duration (+X hours) and escalation levels.
- **Interactive Multi-Filter:** Filter analytics by custom date ranges (From / To), department, ticket category, priority, and status with a one-click reset action.
- **CSV Data Export:** Download filtered operational reports for management reviews.

### 4. Background SLA & Escalation Engine
- Automated background worker (`node-cron`) running every 15 minutes checking active tickets against hospital SLA policies and auto-escalating overdue tasks with in-app/email alerts.

---

## Technology Stack

- **Runtime & Framework:** Node.js, Express 5
- **Database & ODM:** MongoDB, Mongoose 9
- **Templating & UI:** EJS, Bootstrap 5, Bootstrap Icons
- **Barcode & QR Generation:** `qrcode` (PNG data URIs, SVG, and client-side safe canvas rendering)
- **Security:** Helmet, Express Rate Limit, Express Session with Connect-Mongo, Bcrypt.js
- **Testing:** Jest, Supertest

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB running locally on `127.0.0.1:27017`

### Setup & Run

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment (`.env`):**
   ```env
   NODE_ENV=development
   PORT=3000
   MONGODB_URI=mongodb://127.0.0.1:27017/wardflow
   SESSION_SECRET=wardflow_super_secret_change_in_production_2026
   APP_NAME=WardFlow
   APP_URL=http://localhost:3000
   APP_BASE_URL=http://localhost:3000
   TIMEZONE=Asia/Kolkata
   ```

3. **Seed Database with Sample Data:**
   ```bash
   npm run seed
   ```
   *Creates City Care Hospital, 7 departments, 4 SLA policies, 5 users across roles, and sample tickets.*

4. **Start the Application:**
   ```bash
   npm start
   ```
   *WardFlow will be accessible at `http://localhost:3000`.*

5. **Run the Test Suite:**
   ```bash
   npm test
   ```
   *Runs all integration test suites covering Authentication, Permissions, Tickets, SLA Escalation, QR Reporting, and Analytics.*

---

## Default Seed Login Credentials

| Role | Email | Password |
|---|---|---|
| Hospital Admin | `admin@citycare.com` | `Admin@1234` |
| Operations Manager | `ops@citycare.com` | `Ops@1234` |
| Department Supervisor | `supervisor.bme@citycare.com` | `Super@1234` |
| Support Staff | `staff.biomed@citycare.com` | `Staff@1234` |
| Nurse / Reporter | `nurse.icu@citycare.com` | `Nurse@1234` |

---

## License
Proprietary &copy; 2026 WardFlow Operations.
