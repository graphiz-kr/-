import express from "express";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import session from "express-session";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import path from "path";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: "business-plan-secret",
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: true, 
    sameSite: 'none',
    httpOnly: true 
  }
}));

// Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify transporter on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("Email Transporter Verification Error:", error);
  } else {
    console.log("Email Transporter is ready to send messages");
  }
});

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

// If a refresh token is provided in env, use it globally
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
}

// Google OAuth URL
app.get("/api/auth/google/url", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets"
    ],
    prompt: "consent"
  });
  res.json({ url });
});

// Google OAuth Callback
app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    (req.session as any).tokens = tokens;
    
    // Log the refresh token so the developer can save it to .env
    if (tokens.refresh_token) {
      console.log("==========================================");
      console.log("GOOGLE_REFRESH_TOKEN:", tokens.refresh_token);
      console.log("Save this to your .env file for persistent 'My Drive' storage.");
      console.log("==========================================");
    }

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>인증이 완료되었습니다. 리프레시 토큰이 서버 로그에 출력되었습니다. 이 창은 자동으로 닫힙니다.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth Error:", error);
    res.status(500).send("Authentication failed");
  }
});

// Check if authenticated
app.get("/api/auth/google/status", (req, res) => {
  const tokens = (req.session as any).tokens;
  res.json({ isAuthenticated: !!tokens });
});

// Save email to Google Drive
app.post("/api/save-email-to-drive", async (req, res) => {
  const { email, timestamp } = req.body;
  
  const sessionTokens = (req.session as any).tokens;
  if (!process.env.GOOGLE_REFRESH_TOKEN && !sessionTokens) {
    console.warn("Google Drive not configured. Admin must authenticate first.");
    return res.status(401).json({ error: "Google Drive not configured." });
  }

  if (sessionTokens && !process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials(sessionTokens);
  }

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  try {
    // 1. Find or create a file named "Leads.txt"
    const response = await drive.files.list({
      q: "name = 'Leads.txt' and mimeType = 'text/plain'",
      fields: "files(id, name)",
      spaces: "drive"
    });

    let fileId = response.data.files?.[0]?.id;
    const content = `[${timestamp}] ${email}\n`;

    if (fileId) {
      // 2. Append to existing file (Drive doesn't support append directly, so we get and update)
      const file = await drive.files.get({ fileId, alt: "media" });
      const newContent = (file.data as string) + content;
      
      await drive.files.update({
        fileId,
        media: {
          mimeType: "text/plain",
          body: newContent
        }
      });
    } else {
      // 3. Create new file
      await drive.files.create({
        requestBody: {
          name: "Leads.txt",
          mimeType: "text/plain"
        },
        media: {
          mimeType: "text/plain",
          body: content
        }
      });
    }

    res.json({ status: "ok" });
  } catch (error) {
    console.error("Drive Save Error:", error);
    res.status(500).json({ error: "Failed to save to Drive" });
  }
});

// Save to Google Sheets
app.post("/api/save-to-sheets", async (req, res) => {
  const { email, title, content, timestamp } = req.body;
  
  const sessionTokens = (req.session as any).tokens;
  if (!process.env.GOOGLE_REFRESH_TOKEN && !sessionTokens) {
    return res.status(401).json({ error: "Google Drive not configured." });
  }

  if (sessionTokens && !process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials(sessionTokens);
  }

  const sheets = google.sheets({ version: "v4", auth: oauth2Client });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  try {
    // 1. Find or create a spreadsheet named "BusinessPlanLeads"
    const searchResponse = await drive.files.list({
      q: "name = 'BusinessPlanLeads' and mimeType = 'application/vnd.google-apps.spreadsheet'",
      fields: "files(id, name)",
      spaces: "drive"
    });

    let spreadsheetId = searchResponse.data.files?.[0]?.id;

    if (!spreadsheetId) {
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: "BusinessPlanLeads" },
          sheets: [{ properties: { title: "Leads" } }]
        }
      });
      spreadsheetId = createResponse.data.spreadsheetId!;
      
      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Leads!A1:D1",
        valueInputOption: "RAW",
        requestBody: {
          values: [["Timestamp", "Email", "Project Title", "Content Summary"]]
        }
      });
    }

    // 2. Append row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Leads!A:D",
      valueInputOption: "RAW",
      requestBody: {
        values: [[timestamp, email, title, content.substring(0, 2000)]]
      }
    });

    res.json({ status: "ok" });
  } catch (error) {
    console.error("Sheets Save Error:", error);
    res.status(500).json({ error: "Failed to save to Sheets" });
  }
});

// Create Google Doc
app.post("/api/create-doc", async (req, res) => {
  const { title, content } = req.body;
  
  // Use global credentials if available, otherwise use session
  const sessionTokens = (req.session as any).tokens;
  if (!process.env.GOOGLE_REFRESH_TOKEN && !sessionTokens) {
    return res.status(401).json({ error: "Google Drive not configured. Admin must authenticate first." });
  }

  if (sessionTokens && !process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials(sessionTokens);
  }

  const docs = google.docs({ version: "v1", auth: oauth2Client });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  try {
    // 1. Create a new Google Doc
    const doc = await docs.documents.create({
      requestBody: {
        title: title || "AI 생성 사업계획서"
      }
    });

    const documentId = doc.data.documentId;

    // 2. Insert content
    await docs.documents.batchUpdate({
      documentId: documentId!,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: content
            }
          }
        ]
      }
    });

    // 3. Make the file viewable by anyone with the link
    await drive.permissions.create({
      fileId: documentId!,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    // 4. Get the link
    const file = await drive.files.get({
      fileId: documentId!,
      fields: "webViewLink"
    });

    res.json({ url: file.data.webViewLink });
  } catch (error) {
    console.error("Doc Creation Error:", error);
    res.status(500).json({ error: "Failed to create document" });
  }
});

// Send Email
app.post("/api/send-email", async (req, res) => {
  const { email, title, content } = req.body;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("Email credentials not set. Skipping email send.");
    return res.status(200).json({ status: "skipped", message: "Email credentials not configured." });
  }

  try {
    await transporter.sendMail({
      from: `"GRAPHiz MATCH" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `[사업계획서] ${title}`,
      text: `안녕하세요, GRAPHiz MATCH입니다.\n\n요청하신 사업계획서가 생성되었습니다.\n\n${content.substring(0, 1000)}...\n\n상세 내용은 웹사이트에서 확인해 주세요.`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4f46e5;">사업계획서 생성이 완료되었습니다</h2>
          <p>안녕하세요, <strong>GRAPHiz MATCH</strong>입니다.</p>
          <p>요청하신 <strong>${title}</strong> 리포트가 성공적으로 생성되었습니다.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <div style="background-color: #f9fafb; padding: 20px; border-radius: 12px;">
            ${content.replace(/\n/g, '<br>')}
          </div>
          <p style="font-size: 12px; color: #6b7280; margin-top: 20px;">
            본 메일은 발신 전용입니다. 궁금하신 사항은 고객센터로 문의해 주세요.
          </p>
        </div>
      `
    });
    res.json({ status: "ok" });
  } catch (error) {
    console.error("Email Send Error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Request Download (Email to Admin)
app.post("/api/request-download", async (req, res) => {
  const { email, title, content, userInputs } = req.body;
  
  // 관리자 이메일 고정 
  const adminEmail = "graphiz@graphiz.kr"; 

  try {
    await transporter.sendMail({
      from: `"GRAPHiz MATCH 시스템" <${process.env.EMAIL_USER}>`,
      to: adminEmail,
      subject: `[사업계획서 생성 알림] ${title} - ${email}`,
      text: `새로운 사업계획서가 생성되었습니다.\n\n사용자: ${email}\n사업명: ${title}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 24px;">
          <h2 style="color: #4f46e5;">사업계획서 생성 알림</h2>
          <p><strong>사용자 이메일:</strong> ${email}</p>
          <p><strong>사업명:</strong> ${title}</p>
          <hr>
          <h3>사용자 입력 정보</h3>
          <pre>${JSON.stringify(userInputs, null, 2)}</pre>
          <h3>리포트 내용 요약</h3>
          <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
            ${content.substring(0, 1000).replace(/\n/g, '<br>')}...
          </div>
        </div>
      `
    });
    res.json({ status: "ok" });
  } catch (error) {
    console.error("관리자 메일 발송 실패:", error);
    res.status(500).json({ error: "메일 발송 실패" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
