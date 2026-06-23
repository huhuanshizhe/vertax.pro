/**
 * Test middleware behavior for different domains
 */

async function testDomain(domain: string) {
  console.log(`\n🔍 Testing: ${domain}`);
  console.log('═'.repeat(60));
  
  try {
    const response = await fetch(`https://${domain}/`, {
      method: 'GET',
      headers: {
        'Host': domain,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'manual',
    });
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Location: ${response.headers.get('location') || 'N/A'}`);
    console.log(`Server: ${response.headers.get('server') || 'N/A'}`);
    
    if (response.status === 200) {
      const html = await response.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/);
      console.log(`Title: ${titleMatch ? titleMatch[1] : 'N/A'}`);
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
  }
}

async function main() {
  console.log('🚀 Testing Middleware Behavior\n');
  
  await testDomain('vertax.pro');
  await testDomain('tdpaint.vertax.pro');
  await testDomain('machrio.vertax.pro');
  await testDomain('tower.vertax.pro');
  
  console.log('\n✅ Test completed!');
}

main().catch(console.error);
