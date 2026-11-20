import * as cheerio from 'cheerio';

/**
 * ZTTeam: Tiện ích tách / ghép nội dung bài viết phục vụ AI viết lại toàn bộ bài.
 * - Tách HTML thành các "đoạn" văn bản (p, h1-h6, li, blockquote, figcaption) theo đúng thứ tự.
 * - Sau khi AI viết lại, ghép từng đoạn mới vào đúng vị trí cũ => ảnh, cấu trúc bài giữ nguyên.
 */

const ZTTEAM_TEXT_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption';

const ztteam_countWords = (t: string) => (t || '').trim().split(/\s+/).filter(Boolean).length;
const ztteam_normalize = (t: string) => (t || '').replace(/\s+/g, ' ').trim();

export interface ZTTeamRewritePlan {
  mode: 'html' | 'plain';
  segments: string[];
  /** Ghép các đoạn đã viết lại thành nội dung đăng WordPress */
  rebuild: (newSegments: string[]) => string;
}

/**
 * Chế độ HTML: dùng khi đăng bài kèm ảnh trong nội dung.
 * Trả về null nếu cấu trúc HTML không bao phủ đủ nội dung văn bản (tránh sót đoạn chưa viết lại).
 */
export function ztteam_buildHtmlRewritePlan(html: string, plainContent: string): ZTTeamRewritePlan | null {
  if (!html || !html.trim()) return null;

  const $ = cheerio.load(html, null, false);
  const nodes: any[] = [];
  const segments: string[] = [];

  $(ZTTEAM_TEXT_BLOCKS).each((_, el) => {
    /** Chỉ lấy khối "lá" (không chứa khối văn bản khác bên trong) để tránh viết lại trùng */
    if ($(el).find(ZTTEAM_TEXT_BLOCKS).length > 0) return;
    const text = ztteam_normalize($(el).text());
    if (!text) return;
    nodes.push(el);
    segments.push(text);
  });

  if (segments.length === 0) return null;

  /** Kiểm tra độ bao phủ: các khối phải chứa >= 80% số từ của nội dung thuần */
  const blockWords = segments.reduce((a, s) => a + ztteam_countWords(s), 0);
  const plainWords = ztteam_countWords(plainContent);
  if (plainWords > 0 && blockWords / plainWords < 0.8) return null;

  return {
    mode: 'html',
    segments,
    rebuild: (newSegments: string[]) => {
      nodes.forEach((el, i) => {
        const node = $(el);
        /** Giữ lại ảnh nằm bên trong đoạn văn (nếu có) */
        const imgs = node.find('img').toArray().map(img => $.html(img));
        node.text(newSegments[i]);
        if (imgs.length > 0) node.append(imgs.join(''));
      });
      return $.html();
    },
  };
}

/** Chế độ văn bản thuần: dùng khi không giữ ảnh trong bài hoặc HTML không đủ điều kiện */
export function ztteam_buildPlainRewritePlan(plainContent: string): ZTTeamRewritePlan | null {
  const paragraphs = (plainContent || '').split(/\n\s*\n/).map(ztteam_normalize).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return {
    mode: 'plain',
    segments: paragraphs,
    rebuild: (newSegments: string[]) => newSegments.join('\n\n'),
  };
}

/**
 * Chế độ văn bản thuần nhưng xuất HTML có ảnh (phân bổ ảnh đều giữa các đoạn như fetcher đang làm).
 * Dùng khi bật giữ ảnh nhưng cấu trúc HTML gốc không tách được đoạn.
 */
export function ztteam_buildPlainWithImagesPlan(plainContent: string, images: string[]): ZTTeamRewritePlan | null {
  const base = ztteam_buildPlainRewritePlan(plainContent);
  if (!base) return null;
  const imgs = (images || []).filter(Boolean);
  return {
    mode: 'plain',
    segments: base.segments,
    rebuild: (newSegments: string[]) => {
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (imgs.length === 0) return newSegments.map(p => `<p>${esc(p)}</p>`).join('\n');
      const step = Math.max(1, Math.floor(newSegments.length / (imgs.length + 1)));
      const parts: string[] = [];
      let imgIdx = 0;
      newSegments.forEach((p, idx) => {
        parts.push(`<p>${esc(p)}</p>`);
        if ((idx + 1) % step === 0 && imgIdx < imgs.length) {
          parts.push(`<p><img src="${imgs[imgIdx]}" alt="" /></p>`);
          imgIdx++;
        }
      });
      while (imgIdx < imgs.length) {
        parts.push(`<p><img src="${imgs[imgIdx]}" alt="" /></p>`);
        imgIdx++;
      }
      return parts.join('\n');
    },
  };
}
