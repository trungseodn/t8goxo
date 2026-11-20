import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const allImages = await prisma.ztteam_images.findMany({
    select: { wp_post_id: true }
  });
  const usedIds = new Set(allImages.map(i => i.wp_post_id));
  console.log('Total used post IDs in ztteam_images:', usedIds.size);

  let page = 1;
  let unusedCount = 0;
  let totalFetched = 0;

  while (page <= 60) {
    try {
      const res = await axios.get(`https://is.imsb.info/wp-json/wp/v2/posts?per_page=100&page=${page}`, {
        timeout: 10000
      });
      if (!res.data || res.data.length === 0) break;
      totalFetched += res.data.length;
      for (const post of res.data) {
        if (!usedIds.has(post.id.toString())) {
          unusedCount++;
        }
      }
      page++;
    } catch (e: any) {
      console.log('Fetch ended at page', page, e.message);
      break;
    }
  }

  console.log('Total posts fetched from WP:', totalFetched);
  console.log('Total unused posts found:', unusedCount);
}

main().catch(console.error).finally(() => prisma.$disconnect());
