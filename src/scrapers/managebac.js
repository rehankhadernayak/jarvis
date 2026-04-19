/**
 * ManageBac Scraper
 * Headless Chromium scraper for the ManageBac school portal.
 * Stores cookies + data in the JARVIS DB memory table.
 *
 * NOTE: ManageBac's HTML structure can vary by school plan and IB programme.
 * Selectors have multiple fallbacks and verbose logging so debugging is easy.
 * Adjust selectors in SELECTORS below if the first sync looks empty.
 */

'use strict';

const { chromium } = require('playwright');
const { getMemory, setMemory } = require('../db/init');

const BASE_URL = 'https://app.managebac.com';
const NAV_TIMEOUT = 30000;   // 30s for page navigation
const EL_TIMEOUT  = 10000;   // 10s for element waits

// ── Selector banks ────────────────────────────────────────────────────────────
// Each entry is tried in order; first match wins.

const SELECTORS = {
  // Login page
  emailField:    ['input[name="user[email]"]',    'input[type="email"]',    '#user_email',    'input[placeholder*="email" i]'],
  passwordField: ['input[name="user[password]"]', 'input[type="password"]', '#user_password', 'input[placeholder*="password" i]'],
  submitBtn:     ['input[type="submit"]',          'button[type="submit"]',  '.btn-primary',   'button:has-text("Sign in")', 'button:has-text("Log in")'],

  // Grades — table rows
  gradeTable:    ['table.grades-table', 'table.report-card-table', '.grades-container table', 'table'],
  gradeRow:      ['tr.grade-row', 'tr[data-subject]', 'tbody tr'],

  // Assignments / tasks
  taskItem:      ['.task-item', '.assignment-item', '.event-item', '.upcoming-task'],
  taskList:      ['.tasks-list', '.assignments-list', '#upcoming-tasks', '.upcoming-events', 'ul.tasks', 'ul.events'],

  // Generic list fallbacks
  listItem:      ['li.task', 'li.assignment', 'li.event', 'li[data-due]', '.list-group-item'],
};

// Candidate grade page URLs (tried in order)
const GRADE_URLS = [
  `${BASE_URL}/student/ib-dp/grades`,
  `${BASE_URL}/student/ib-myp/grades`,
  `${BASE_URL}/student/grades`,
];

// Candidate assignment page URLs (tried in order)
const TASK_URLS = [
  `${BASE_URL}/student/events/upcoming`,
  `${BASE_URL}/student/tasks`,
  `${BASE_URL}/student/assignments`,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Launch a headless Chromium browser.
 * Always uses the Chromium installed by Playwright.
 */
async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

/**
 * Try a list of selectors and return the first one found within timeout.
 * Returns null if none found.
 */
async function findFirst(page, selectors, timeout = EL_TIMEOUT) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: Math.min(timeout, 3000) });
      console.log(`[managebac] Matched selector: ${sel}`);
      return sel;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Detect if we were redirected to the login page (session expired).
 */
function isLoginPage(url) {
  return url.includes('/login') || url.includes('/sign_in') || url.includes('/users/sign_in');
}

/**
 * Load cookies from DB and add them to a new browser context.
 * Returns { browser, context, page } or throws if no cookies saved.
 */
async function createContextWithCookies() {
  const raw = getMemory('managebac_cookies');
  if (!raw) throw new Error('no_cookies');

  const cookies = JSON.parse(raw);
  const browser = await launchBrowser();
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  page.setDefaultTimeout(EL_TIMEOUT);
  return { browser, context, page };
}

// ── Core exported functions ───────────────────────────────────────────────────

/**
 * login(email, password)
 * Launches browser, navigates to ManageBac login, fills credentials,
 * submits and waits for successful redirect. Saves cookies to DB.
 */
async function login(email, password) {
  let browser;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    page.setDefaultTimeout(EL_TIMEOUT);

    console.log('[managebac] Navigating to login page...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });

    // Fill email
    const emailSel = await findFirst(page, SELECTORS.emailField, EL_TIMEOUT);
    if (!emailSel) return { error: 'Could not find email field on login page' };
    await page.fill(emailSel, email);

    // Fill password
    const pwSel = await findFirst(page, SELECTORS.passwordField, EL_TIMEOUT);
    if (!pwSel) return { error: 'Could not find password field on login page' };
    await page.fill(pwSel, password);

    // Submit
    const btnSel = await findFirst(page, SELECTORS.submitBtn, EL_TIMEOUT);
    if (!btnSel) return { error: 'Could not find login button' };

    console.log('[managebac] Submitting login form...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }),
      page.click(btnSel),
    ]);

    const currentUrl = page.url();
    console.log(`[managebac] Post-login URL: ${currentUrl}`);

    // If still on login page, credentials likely wrong
    if (isLoginPage(currentUrl)) {
      // Check for error message
      const errText = await page.$eval(
        '.alert, .flash-error, .error-message, [class*="error"]',
        el => el.textContent.trim()
      ).catch(() => 'Invalid credentials');
      return { error: `Login failed: ${errText}` };
    }

    // Save cookies
    const cookies = await context.cookies();
    setMemory('managebac_cookies', JSON.stringify(cookies));
    console.log(`[managebac] Login successful. Saved ${cookies.length} cookies.`);

    await browser.close();
    return { ok: true, email };

  } catch (e) {
    console.error('[managebac] login() error:', e.message);
    if (browser) await browser.close().catch(() => {});
    return { error: e.message };
  }
}

/**
 * getGrades()
 * Loads saved cookies, navigates to grades pages, parses grade table.
 * Returns array of { subject, grade, predicted, teacher }
 */
async function getGrades() {
  let browser;
  try {
    const { browser: b, context, page } = await createContextWithCookies().catch(e => {
      if (e.message === 'no_cookies') throw Object.assign(new Error('auth_required'), { code: 'auth_required' });
      throw e;
    });
    browser = b;

    let grades = [];
    let foundPage = false;

    for (const url of GRADE_URLS) {
      console.log(`[managebac] Trying grades URL: ${url}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

        // Check auth redirect
        if (isLoginPage(page.url())) {
          console.log('[managebac] Session expired — redirected to login');
          await browser.close();
          return { error: 'auth_required', grades: [] };
        }

        // Try to find a grade table
        const tableSel = await findFirst(page, SELECTORS.gradeTable, 5000);
        if (!tableSel) {
          console.log(`[managebac] No grade table at ${url}, trying next...`);
          continue;
        }

        foundPage = true;
        console.log(`[managebac] Found grade table at ${url}`);

        // Extract rows using $$eval for bulk extraction
        grades = await page.$$eval('table tr', rows => {
          const results = [];
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td, th')).map(c => c.textContent.trim());
            if (cells.length < 2) continue;

            // Skip header rows (all cells look like headers)
            const isHeader = row.querySelector('th') && !row.querySelector('td');
            if (isHeader) continue;

            // Heuristic: first cell = subject, look for grade-like cells
            // Grade cells typically contain numbers (1-7 for IB) or letter grades
            const subject = cells[0];
            if (!subject || subject.length > 100) continue; // skip garbage rows

            // Try to find grade value — look for IB-style grades (1-7) or letter grades
            const gradePattern = /^[1-7]$|^[A-F][+-]?$|^[0-9]{1,3}%?$|^[0-9]+\/[0-9]+$/;
            let grade = null;
            let predicted = null;
            let teacher = null;

            for (let i = 1; i < cells.length; i++) {
              const val = cells[i].trim();
              if (gradePattern.test(val)) {
                if (!grade) grade = val;
                else if (!predicted) predicted = val;
              }
              // Teacher name heuristic: contains space, starts with capital, > 4 chars
              if (!teacher && /^[A-Z][a-z]+ [A-Z]/.test(val)) {
                teacher = val;
              }
            }

            if (subject && (grade || predicted)) {
              results.push({ subject, grade: grade || null, predicted: predicted || null, teacher: teacher || null });
            }
          }
          return results;
        }).catch(e => {
          console.error('[managebac] $$eval grades error:', e.message);
          return [];
        });

        // If empty, try alternative approach: look for definition lists or cards
        if (grades.length === 0) {
          grades = await page.$$eval('.subject-row, .grade-item, [data-subject], .course-grade', items => {
            return items.map(item => ({
              subject: item.querySelector('.subject-name, .course-name, [class*="subject"]')?.textContent.trim() || item.getAttribute('data-subject') || null,
              grade:   item.querySelector('.grade-value, .current-grade, [class*="grade"]')?.textContent.trim() || null,
              predicted: item.querySelector('.predicted-grade, [class*="predicted"]')?.textContent.trim() || null,
              teacher:   item.querySelector('.teacher-name, [class*="teacher"]')?.textContent.trim() || null,
            })).filter(g => g.subject);
          }).catch(() => []);
        }

        console.log(`[managebac] Parsed ${grades.length} grade entries`);
        break; // success — stop trying other URLs
      } catch (navErr) {
        console.error(`[managebac] Navigation error for ${url}:`, navErr.message);
        continue;
      }
    }

    await browser.close();

    if (!foundPage) {
      console.warn('[managebac] No grades page found across all candidate URLs');
    }

    return grades;

  } catch (e) {
    console.error('[managebac] getGrades() error:', e.message);
    if (browser) await browser.close().catch(() => {});
    if (e.code === 'auth_required') return { error: 'auth_required', grades: [] };
    return { error: e.message, grades: [] };
  }
}

/**
 * getAssignments()
 * Loads saved cookies, navigates to upcoming tasks/assignments pages, parses them.
 * Returns array of { title, subject, due_date, type, url }
 */
async function getAssignments() {
  let browser;
  try {
    const { browser: b, context, page } = await createContextWithCookies().catch(e => {
      if (e.message === 'no_cookies') throw Object.assign(new Error('auth_required'), { code: 'auth_required' });
      throw e;
    });
    browser = b;

    let assignments = [];
    let foundPage = false;

    for (const url of TASK_URLS) {
      console.log(`[managebac] Trying assignments URL: ${url}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

        if (isLoginPage(page.url())) {
          console.log('[managebac] Session expired — redirected to login');
          await browser.close();
          return { error: 'auth_required', assignments: [] };
        }

        // Strategy 1: dedicated task/event item elements
        const taskSel = await findFirst(page, [...SELECTORS.taskItem, ...SELECTORS.listItem], 5000);

        if (taskSel) {
          foundPage = true;
          console.log(`[managebac] Found task items using selector: ${taskSel}`);

          assignments = await page.$$(taskSel).then(handles =>
            page.$$eval(taskSel, items =>
              items.map(item => {
                // Title — try multiple approaches
                const title = (
                  item.querySelector('.task-title, .event-title, .assignment-title, h4, h3, strong, a')?.textContent.trim() ||
                  item.getAttribute('data-title') ||
                  item.textContent.trim().split('\n')[0].trim()
                );

                // Subject
                const subject = (
                  item.querySelector('.subject, .course-name, [class*="subject"], [data-subject]')?.textContent.trim() ||
                  item.getAttribute('data-subject') ||
                  null
                );

                // Due date — look for date strings or time elements
                const dueDateEl = item.querySelector('time, .due-date, .deadline, [class*="due"], [datetime]');
                const due_date = dueDateEl?.getAttribute('datetime') || dueDateEl?.textContent.trim() || null;

                // Type (assignment, test, essay, etc.)
                const type = (
                  item.querySelector('.task-type, .event-type, [class*="type"], .badge')?.textContent.trim() ||
                  item.getAttribute('data-type') ||
                  null
                );

                // URL — find first anchor
                const anchor = item.querySelector('a[href]');
                const itemUrl = anchor ? anchor.getAttribute('href') : null;

                return {
                  title: title || 'Untitled',
                  subject: subject || null,
                  due_date: due_date || null,
                  type: type || null,
                  url: itemUrl ? (itemUrl.startsWith('http') ? itemUrl : `https://app.managebac.com${itemUrl}`) : null,
                };
              }).filter(a => a.title && a.title !== 'Untitled')
            )
          ).catch(e => {
            console.error('[managebac] $$eval tasks error:', e.message);
            return [];
          });
        }

        // Strategy 2: table-based layout
        if (assignments.length === 0) {
          const hasTable = await page.$('table').catch(() => null);
          if (hasTable) {
            assignments = await page.$$eval('table tbody tr', rows =>
              rows.map(row => {
                const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim());
                if (cells.length < 2) return null;
                const anchor = row.querySelector('a[href]');
                return {
                  title:    cells[0] || 'Untitled',
                  subject:  cells[1] || null,
                  due_date: cells[2] || cells[3] || null,
                  type:     cells[cells.length - 1] || null,
                  url:      anchor ? `https://app.managebac.com${anchor.getAttribute('href')}` : null,
                };
              }).filter(Boolean).filter(a => a.title !== 'Untitled')
            ).catch(() => []);
          }
        }

        if (assignments.length > 0) {
          foundPage = true;
          console.log(`[managebac] Parsed ${assignments.length} assignments at ${url}`);
          break;
        }

        console.log(`[managebac] No assignments found at ${url}, trying next...`);
      } catch (navErr) {
        console.error(`[managebac] Navigation error for ${url}:`, navErr.message);
        continue;
      }
    }

    await browser.close();

    if (!foundPage) {
      console.warn('[managebac] No assignments page found across all candidate URLs');
    }

    return assignments;

  } catch (e) {
    console.error('[managebac] getAssignments() error:', e.message);
    if (browser) await browser.close().catch(() => {});
    if (e.code === 'auth_required') return { error: 'auth_required', assignments: [] };
    return { error: e.message, assignments: [] };
  }
}

/**
 * getDashboard()
 * Runs getGrades() and getAssignments() in parallel, saves results to DB.
 * Returns { grades, assignments, synced_at }
 */
async function getDashboard() {
  try {
    // Verify we have cookies before firing two parallel browser sessions
    const hasCookies = getMemory('managebac_cookies');
    if (!hasCookies) {
      return { error: 'auth_required', grades: [], assignments: [] };
    }

    console.log('[managebac] Starting dashboard sync...');
    const [gradesResult, assignmentsResult] = await Promise.all([
      getGrades(),
      getAssignments(),
    ]);

    // Handle auth_required from either call
    if (gradesResult?.error === 'auth_required' || assignmentsResult?.error === 'auth_required') {
      return { error: 'auth_required', grades: [], assignments: [] };
    }

    const grades = Array.isArray(gradesResult) ? gradesResult : (gradesResult?.grades || []);
    const assignments = Array.isArray(assignmentsResult) ? assignmentsResult : (assignmentsResult?.assignments || []);

    const synced_at = new Date().toISOString();

    setMemory('managebac_grades',      JSON.stringify(grades));
    setMemory('managebac_assignments', JSON.stringify(assignments));
    setMemory('managebac_last_sync',   synced_at);

    console.log(`[managebac] Dashboard sync complete — ${grades.length} grades, ${assignments.length} assignments`);
    return { grades, assignments, synced_at };

  } catch (e) {
    console.error('[managebac] getDashboard() error:', e.message);
    return { error: e.message, grades: [], assignments: [] };
  }
}

module.exports = { login, getGrades, getAssignments, getDashboard };
