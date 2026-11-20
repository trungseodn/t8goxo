import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import axios from 'axios';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import {
  ztteam_buildHtmlRewritePlan,
  ztteam_buildPlainRewritePlan,
} from '../crawler/article-rewrite.util';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function decrypt(encryptedText: string): string {
  if (!encryptedText) return '';
  const [ivHex, encrypted] = encryptedText.split(':');
  if (!ivHex || !encrypted) return encryptedText;

  const keys = [
    crypto.scryptSync(process.env.JWT_SECRET || 'default-secret-key-32-chars-long!', 'salt', 32),
    crypto.scryptSync('default-secret-key-32-chars-long!', 'salt', 32),
    crypto.scryptSync('ZTREEL_SECRET_KEY_2026', 'salt', 32),
  ];

  for (const key of keys) {
    try {
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let dec = decipher.update(encrypted, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    } catch {}
  }
  return encryptedText;
}

let isStopping = false;
process.on('SIGINT', () => {
  console.log('\n[Graceful Shutdown] Received SIGINT. Finishing current articles and exiting...');
  isStopping = true;
});
process.on('SIGTERM', () => {
  console.log('\n[Graceful Shutdown] Received SIGTERM. Finishing current articles and exiting...');
  isStopping = true;
});

async function rewriteArticle(
  client: OpenAI,
  siteUrl: string,
  authHeader: string,
  wpPostId: string,
  fallbackTitle: string
): Promise<{ success: boolean; oldTitle?: string; newTitle?: string; message?: string }> {
  // 1. Fetch from WordPress
  let wpPost: any;
  try {
    const res = await axios.get(`${siteUrl}/wp-json/wp/v2/posts/${wpPostId}`, {
      headers: { Authorization: authHeader },
      timeout: 20000,
    });
    wpPost = res.data;
  } catch (e: any) {
    return { success: false, message: `WP fetch error: ${e.response?.status || e.message}` };
  }

  const rawTitle = (wpPost.title?.raw || wpPost.title?.rendered || fallbackTitle || '').trim();
  const rawHtml = wpPost.content?.raw || wpPost.content?.rendered || '';
  if (!rawHtml.trim()) {
    return { success: false, message: 'Empty post content on WP' };
  }

  const cleanTitle = cheerio.load(rawTitle).text().trim();
  const plainContent = cheerio.load(rawHtml).text().replace(/\s+/g, ' ').trim();

  const plan = ztteam_buildHtmlRewritePlan(rawHtml, plainContent)
    || ztteam_buildPlainRewritePlan(plainContent);

  if (!plan || plan.segments.length === 0) {
    return { success: false, message: 'Could not extract segments' };
  }

  // 2. Call DeepSeek
  const countWords = (t: string) => (t || '').trim().split(/\s+/).filter(Boolean).length;
  const chunks: string[][] = [];
  let cur: string[] = [];
  let curWords = 0;
  for (const seg of plan.segments) {
    const w = countWords(seg);
    if (cur.length > 0 && curWords + w > 1200) {
      chunks.push(cur);
      cur = [];
      curWords = 0;
    }
    cur.push(seg);
    curWords += w;
  }
  if (cur.length > 0) chunks.push(cur);

  let newTitle = cleanTitle;
  const output: string[] = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const isFirst = ci === 0;
    const prevContext = output.slice(-2).join('\n\n');
    const chunkWords = chunk.reduce((a, s) => a + countWords(s), 0);
    const numbered = chunk.map((s, i) => `[${i + 1}] ${s}`).join('\n\n');

    const prompt = `You are a senior editor who rewrites articles so they read as fresh, original writing while feeling exactly like the original.

TASK: Rewrite ${isFirst ? 'the TITLE and ' : ''}the ${chunk.length} numbered paragraphs below${chunks.length > 1 ? ` (part ${ci + 1} of ${chunks.length} of one article)` : ''}.

RULES
- Write in the SAME LANGUAGE as the original. Never translate.
- Keep the same voice, tone, point of view and tense.
- Keep the same opening style, the same way the story is led and unfolded, and the same pacing and suspense that keeps readers reading. Preserve hooks, cliffhangers and transitions.
- Keep the SAME LENGTH: each rewritten paragraph must be about as long as its original (within ±10% words). Total original length of this part: ~${chunkWords} words.
- Return EXACTLY ${chunk.length} paragraphs, in the same order, one rewritten paragraph per original paragraph. Never merge, split, add or drop paragraphs.
- Keep every fact, name, number, date and place unchanged. Do NOT invent details, dialogue, people, motives or events.
- Use new wording and sentence structures; do not copy sentences verbatim.
- Plain text only inside paragraphs (no HTML, no markdown, no paragraph numbers).${isFirst ? `
- TITLE: rewrite it in the same language, keep it a compelling hook of similar length and meaning, without clickbait lies.` : ''}
${prevContext ? `\nPREVIOUS REWRITTEN PARAGRAPHS (context only, do NOT return them):\n"""\n${prevContext}\n"""\n` : ''}${isFirst ? `\nORIGINAL TITLE: ${cleanTitle}\n` : ''}
ORIGINAL PARAGRAPHS:
"""
${numbered}
"""

Return STRICTLY one valid JSON object, no extra text:
{${isFirst ? '"title": "rewritten title", ' : ''}"paragraphs": ["paragraph 1", "paragraph 2"]}`;

    let accepted: string[] | null = null;
    for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
      try {
        const estTokens = Math.min(8000, Math.max(1500, Math.round(chunkWords * 3) + 500));
        const res = await client.chat.completions.create({
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
          max_tokens: estTokens,
          temperature: 0.8,
        });

        const raw = res.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);
        const paras: string[] = Array.isArray(parsed?.paragraphs)
          ? parsed.paragraphs.map((p: any) => String(p ?? '').replace(/<[^>]*>?/gm, '').replace(/^\s*\[\d+\]\s*/, '').trim())
          : [];

        if (paras.length === chunk.length && !paras.some(p => !p)) {
          if (isFirst && typeof parsed?.title === 'string') {
            const t = parsed.title.replace(/<[^>]*>?/gm, '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
            if (t.length >= 10 && t.length <= Math.max(200, cleanTitle.length * 2)) newTitle = t;
          }
          accepted = paras;
        }
      } catch (err: any) {
        if (attempt === 2) throw err;
      }
    }

    if (!accepted) {
      return { success: false, message: `Chunk ${ci + 1}/${chunks.length} rewrite rejected` };
    }
    output.push(...accepted);
  }

  const newContentHtml = plan.rebuild(output);

  // 3. Update to WordPress
  try {
    await axios.post(
      `${siteUrl}/wp-json/wp/v2/posts/${wpPostId}`,
      { title: newTitle, content: newContentHtml },
      { headers: { Authorization: authHeader, 'Content-Type': 'application/json' }, timeout: 25000 }
    );
  } catch (e: any) {
    return { success: false, message: `WP update failed: ${e.response?.status || e.message}` };
  }

  // 4. Update database
  await prisma.ztteam_images.updateMany({
    where: { wp_post_id: wpPostId },
    data: {
      wp_post_title: newTitle,
      ai_script: 'AI_REWRITTEN',
      updated_at: new Date(),
    }
  });

  return { success: true, oldTitle: cleanTitle, newTitle };
}

async function main() {
  console.log('===============================================================');
  console.log('=== ZTTeam: AI Rewrite Articles for Queued Videos (DeepSeek) ===');
  console.log('===============================================================');

  const args = process.argv.slice(2);
  let limit = 0;
  let concurrency = 3;
  let onlyCompleted = false;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1], 10) || 0;
    if (arg.startsWith('--concurrency=')) concurrency = parseInt(arg.split('=')[1], 10) || 3;
    if (arg === '--only-completed') onlyCompleted = true;
  }

  // 1. Check settings
  const site = await prisma.ztteam_target_sites.findFirst({ where: { status: 'active' } })
    || await prisma.ztteam_target_sites.findFirst();
  if (!site) throw new Error('No target site found in database.');

  const pass = decrypt(site.wp_app_password_encrypted);
  const authHeader = 'Basic ' + Buffer.from(`${site.wp_username}:${pass}`).toString('base64');
  const siteUrl = site.wp_url.replace(/\/$/, '');

  const setting = await prisma.ztteam_settings.findUnique({ where: { key: 'deepseek_api_key' } });
  const deepseekKey = (setting?.value || process.env.DEEPSEEK_API_KEY || '').trim();
  if (!deepseekKey) throw new Error('No deepseek_api_key found in settings.');

  const client = new OpenAI({
    apiKey: deepseekKey,
    baseURL: 'https://api.deepseek.com',
    timeout: 120000,
  });

  // 2. Fetch distinct queued posts that have not yet been rewritten
  const queuedImages = await prisma.ztteam_images.findMany({
    where: {
      is_posted: false,
      OR: [
        { ai_script: null },
        { ai_script: { not: 'AI_REWRITTEN' } }
      ],
      ...(onlyCompleted ? { video_status: 'COMPLETED' } : {})
    },
    select: {
      id: true,
      wp_post_id: true,
      wp_post_title: true,
      video_status: true,
      created_at: true,
    },
    orderBy: [
      { video_status: 'asc' }, // 'COMPLETED' comes before 'PENDING'
      { created_at: 'asc' }
    ]
  });

  const uniquePostsMap = new Map<string, typeof queuedImages[0]>();
  for (const img of queuedImages) {
    if (img.wp_post_id && !uniquePostsMap.has(img.wp_post_id)) {
      uniquePostsMap.set(img.wp_post_id, img);
    }
  }

  let candidates = Array.from(uniquePostsMap.values());
  if (limit > 0) candidates = candidates.slice(0, limit);

  const completedCount = candidates.filter(c => c.video_status === 'COMPLETED').length;
  const pendingCount = candidates.length - completedCount;

  console.log(`Target Site: ${siteUrl} (${site.wp_username})`);
  console.log(`Queued unrewritten articles: ${candidates.length} (COMPLETED videos: ${completedCount}, PENDING: ${pendingCount})`);
  console.log(`Concurrency: ${concurrency} parallel requests | Limit: ${limit || 'ALL'}`);
  console.log('---------------------------------------------------------------');

  let processed = 0;
  let successCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < candidates.length; i += concurrency) {
    if (isStopping) break;
    const batch = candidates.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (item) => {
        if (isStopping) return;
        const itemStart = Date.now();
        processed++;
        const indexStr = `[${processed}/${candidates.length}]`;
        const shortOldTitle = (item.wp_post_title || '').slice(0, 45);

        try {
          const res = await rewriteArticle(client, siteUrl, authHeader, item.wp_post_id, item.wp_post_title);
          const durationSec = ((Date.now() - itemStart) / 1000).toFixed(1);

          if (res.success) {
            successCount++;
            const shortNewTitle = (res.newTitle || '').slice(0, 45);
            console.log(`${indexStr} OK (${durationSec}s) Post #${item.wp_post_id} [${item.video_status}]: "${shortOldTitle}..." -> "${shortNewTitle}..."`);
          } else {
            failedCount++;
            console.log(`${indexStr} FAIL (${durationSec}s) Post #${item.wp_post_id}: ${res.message}`);
          }
        } catch (err: any) {
          failedCount++;
          const durationSec = ((Date.now() - itemStart) / 1000).toFixed(1);
          console.log(`${indexStr} ERROR (${durationSec}s) Post #${item.wp_post_id}: ${err.message}`);
        }
      })
    );
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('===============================================================');
  console.log(`=== BATCH COMPLETE in ${totalTime}s | Success: ${successCount} | Failed: ${failedCount} ===`);
  console.log('===============================================================');
}

main()
  .catch((err) => {
    console.error('Fatal batch rewrite error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
