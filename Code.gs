/**
 * ============================================================
 *  Student Results (Process_log) Dashboard - Apps Script backend
 * ============================================================
 *  Reads pass/fail detection logs from Google Sheets and serves
 *  them to the dashboard frontend (Index.html).
 */

const SHEET_ID = '13kwdqjNAFib_1vx7nUxd0eOvs7Y_r6c0Cu589rN1zyw';
const SHEET_NAME = 'Process_log';

// ============ Email report settings ============
// ใส่ email ของผู้รับรายงานได้หลายคน คั่นด้วยเครื่องหมายจุลภาค (,)
// เช่น 'aaa@mail.com, bbb@mail.com'
const EMAIL_TO = Session.getActiveUser().getEmail();
const EMAIL_SUBJECT = 'ขอนำส่งข้อมูลการตรวจเช็คอุปกรณ์ป้องกันภัยส่วนบุคคล (PPE) ของนักศึกษาและผู้ที่เข้าใช้งานห้องปฏิบัติการประจำวัน (ตามวันที่ส่ง: ';

/**
 * เปลี่ยน EMAIL_TO (string ที่มีเครื่องหมายจุลภาคคั่น) เป็น array ของผู้รับ
 * @return {Array.<string>}
 */
function getEmailRecipients_() {
  return String(EMAIL_TO)
    .split(',')
    .map(function (e) { return e.trim(); })
    .filter(function (e) { return e !== ''; });
}

/**
 * Web app entry point. Deploy as "Web app" -> "Execute as: Me".
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ข้อมูลการตรวจเช็คอุปกรณ์ป้องกันภัยส่วนบุคคล (PPE)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Read all rows from the Process_log sheet and normalize them.
 * Expected columns:
 *   Timestamp | Total Objects | Detected Classes | Pass / Not Pass | Details
 * @return {Array.<Object>}
 */
function getLogs() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('ไม่พบชีต "' + SHEET_NAME + '" ในสเปรดชีต ID: ' + SHEET_ID);
  }

  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];

  const headerMap = {};
  rows[0].forEach((h, i) => { headerMap[String(h).trim().toLowerCase()] = i; });

  const idx = {
    ts: headerMap['timestamp'] !== undefined ? headerMap['timestamp'] : 0,
    total: headerMap['total objects'] !== undefined ? headerMap['total objects'] : 1,
    classes: headerMap['detected classes'] !== undefined ? headerMap['detected classes'] : 2,
    pass: headerMap['pass / not pass'] !== undefined ? headerMap['pass / not pass'] : 3,
    details: headerMap['details'] !== undefined ? headerMap['details'] : 4
  };

  const logs = [];
  const tz = Session.getScriptTimeZone();
  for (let r = 1; r < rows.length; r++) {
    const rawTs = rows[r][idx.ts];
    if (rawTs === '' || rawTs === null || rawTs === undefined) continue;

    const ts = rawTs instanceof Date ? rawTs : new Date(String(rawTs).replace(' ', 'T'));
    if (isNaN(ts.getTime())) continue;

    const total = Number(rows[r][idx.total]) || 0;
    const classesRaw = String(rows[r][idx.classes] || '').trim();
    const passRaw = String(rows[r][idx.pass] || '').trim().toLowerCase();
    const details = String(rows[r][idx.details] || '').trim();

    logs.push({
      // Keep wall-clock time (no timezone suffix) so the browser reads the
      // exact hour from the sheet, matching the 08:00-18:00 hour filter.
      timestamp: Utilities.formatDate(ts, tz, "yyyy-MM-dd'T'HH:mm:ss"),
      total: total,
      classesRaw: classesRaw,
      classList: parseClassList_(classesRaw),
      pass: passRaw === 'pass',
      details: details
    });
  }

  logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return logs;
}

/**
 * Parse the "Detected Classes" column into a clean list of class names.
 * - Splits on comma / pipe / semicolon.
 * - Removes noise tokens such as "No Target Class", "No Target",
 *   "Undefined", "null", "none", empty, etc. so they never become
 *   a chart class or get mixed with a real class like glasses.
 * @param {string} classesRaw
 * @return {Array.<string>}
 */
function parseClassList_(classesRaw) {
  if (!classesRaw) return [];
  var INVALID = /^(no target class|no target|undefined|null|none|nan|-|—|n\/a)$/i;
  return String(classesRaw)
    .split(/[,|;]/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== '' && !INVALID.test(s); });
}

/**
 * Optional: list of all available class names (for building filters).
 * @return {Array.<string>}
 */
function getClasses() {
  const set = {};
  getLogs().forEach(l => l.classList.forEach(c => { set[c] = true; }));
  return Object.keys(set).sort();
}

/**
 * Optional trigger to keep the sheet active / warm on a schedule.
 */
function createRefreshTrigger() {
  ScriptApp.newTrigger('refreshSheet').timeBased().everyMinutes(5).create();
}

function refreshSheet() {
  SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME).activate();
}

/**
 * ============================================================
 *  Daily email report (back-end only, not shown in the UI)
 * ============================================================
 *  Sends a summary email containing the link to this Web App.
 *  Run daily at 18:00 via a time-based trigger.
 *
 *  To activate the trigger, run setupDailyEmailTrigger() once.
 */

function sendDailyReportEmail() {
  const dateOnly = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const webAppUrl = ScriptApp.getService().getUrl();

  const subject = EMAIL_SUBJECT + dateOnly + ')';

  // ---- Plain-text version (fallback) ----
  const body =
    'เรียน อาจารย์และเจ้าหน้าที่ผู้ดูแลห้องปฏิบัติการ คณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น\n\n' +
    'ด้วยงานปฏิบัติการและบริการทางวิศวกรรม ได้จัดทำระบบสำหรับการตรวจเช็คอุปกรณ์ป้องกันภัยส่วนบุคคล (PPE) ' +
    'ของนักศึกษาและผู้ที่เข้าใช้งานห้องปฏิบัติการ ก่อนเข้าห้องปฏิบัติการ เพื่อประเมินความเสี่ยงและความปลอดภัย ก่อนเข้าทำปฏิบัติการ ' +
    'โดยท่านสามารถคลิกลิงก์ด้านล่างนี้ตามเอกสารแนบมานี้ เพื่อติดตามการเข้าใช้งานของนักศึกษาและผู้ที่เข้าใช้งานห้องปฏิบัติการ\n\n' +
    'URL Dashboard: ' + webAppUrl + '\n\n' +
    'จึงเรียนมาเพื่อโปรดทราบและโปรดพิจารณา\n\n' +
    'ขอแสดงความนับถือ\n\n\n\n\n\n\n' +
    'งานปฏิบัติการและบริการทางวิศวกรรม\n' +
    'คณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น';

  // ---- HTML version (with icon link button + centered signature) ----
  const FONT = 'font-family:\'Segoe UI\',\'Noto Sans Thai\',Tahoma,Arial,sans-serif; font-size:15px; line-height:1.8; color:#1f2937;';
  const htmlBody =
    '<div style="' + FONT + '">' +
      '<p style="margin:0 0 6px 0;">เรียน อาจารย์และเจ้าหน้าที่ผู้ดูแลห้องปฏิบัติการ คณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น</p>' +
      '<p style="margin:0 0 6px 0; text-indent:1.5em;">ด้วยงานปฏิบัติการและบริการทางวิศวกรรม ได้จัดทำระบบสำหรับการตรวจเช็คอุปกรณ์ป้องกันภัยส่วนบุคคล (PPE) ของนักศึกษาและผู้ที่เข้าใช้งานห้องปฏิบัติการ ก่อนเข้าห้องปฏิบัติการ เพื่อประเมินความเสี่ยงและความปลอดภัย ก่อนเข้าทำปฏิบัติการ โดยท่านสามารถคลิกลิงก์ด้านล่างนี้ตามเอกสารแนบมานี้ เพื่อติดตามการเข้าใช้งานของนักศึกษาและผู้ที่เข้าใช้งานห้องปฏิบัติการ</p>' +
      '<p style="margin:14px 0 4px 0;">โดยท่านสามารถคลิกลิงก์ด้านล่างนี้เพื่อเปิด Dashboard:</p>' +
      '<div style="text-align:center; margin:18px 0;">' +
        '<a href="' + webAppUrl + '" style="display:inline-block; background-color:#800000; color:#ffffff; padding:12px 28px; border-radius:8px; text-decoration:none; font-size:15px; font-weight:bold;">' +
          'เปิดดูรายงานการเข้าใช้งาน' +
        '</a>' +
      '</div>' +
      '<p style="margin:0 0 6px 0; text-indent:1.5em;">จึงเรียนมาเพื่อโปรดทราบและโปรดพิจารณา</p>' +
      '<div style="text-align:center; margin-top:22px;">ขอแสดงความนับถือ</div>' +
      '<div style="text-align:center; margin-top:115px;">งานปฏิบัติการและบริการทางวิศวกรรม</div>' +
      '<div style="text-align:center; margin-top:6px;">คณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น</div>' +
    '</div>';

  const recipients = getEmailRecipients_();
  MailApp.sendEmail({
    to: recipients.join(','),
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

/**
 * Creates the daily time-based trigger for the email report.
 * Schedules sendDailyReportEmail() to run at 18:00 every day.
 * Run this once in the editor; it will persist after that.
 */
function setupDailyEmailTrigger() {
  ScriptApp.newTrigger('sendDailyReportEmail')
    .timeBased()
    .atHour(18)
    .everyDays(1)
    .create();
  Logger.log('Trigger created: daily at 18:00 -> sendDailyReportEmail()');
}

/**
 * Removes all triggers for sendDailyReportEmail (housekeeping).
 */
function removeDailyEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'sendDailyReportEmail') {
      ScriptApp.deleteTrigger(tr);
    }
  });
  Logger.log('All daily email triggers removed.');
}
