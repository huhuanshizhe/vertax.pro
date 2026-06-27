import { fetchWebContent } from './src/lib/services/web-scraper';

async function main() {
  console.log('Testing fetchWebContent for https://www.farmetra.com/');
  const result = await fetchWebContent('https://www.farmetra.com/', {
    maxChars: 30000,
    timeout: 15000,
  });
  
  console.log('Success:', result.success);
  console.log('Source:', result.source);
  console.log('Title:', result.title);
  console.log('HTML length:', result.html.length);
  console.log('Content length:', result.content.length);
  console.log('HTML preview:', result.html.slice(0, 500));
}
main().catch(e => { console.error(e); process.exit(1); });
