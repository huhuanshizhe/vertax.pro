/**
 * Google Maps API 连通性验证脚本
 * 测试 Places API (New) + Geocoding API
 *
 * 运行: npx tsx scripts/test-google-maps.ts
 */

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyAznyWX5yvezSEk0yth9SF0hDnrDzRx1Bo';

async function testPlacesSearchText() {
  console.log('\n=== Test 1: Places API (New) - SearchText ===');
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber',
      },
      body: JSON.stringify({ textQuery: 'manufacturing company Thailand', pageSize: 3 }),
    });

    const data = await res.json();
    const places = data.places || [];
    console.log(`  Status: ${res.status} | Results: ${places.length}`);

    for (const p of places) {
      console.log(`  - ${p.displayName?.text || 'N/A'}`);
      console.log(`    Address: ${p.formattedAddress || 'N/A'}`);
      console.log(`    Website: ${p.websiteUri || 'N/A'}`);
      console.log(`    Phone: ${p.nationalPhoneNumber || 'N/A'}`);
    }
    return '✅ PASS';
  } catch (err: any) {
    console.log(`  ❌ FAIL: ${err.message}`);
    return '❌ FAIL';
  }
}

async function testGeocoding() {
  console.log('\n=== Test 2: Geocoding API ===');
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=Bangkok+Thailand&key=${API_KEY}`
    );
    const data = await res.json();
    const result = data.results?.[0];
    console.log(`  Status: ${data.status} | Results: ${data.results?.length || 0}`);
    if (result) {
      console.log(`  - ${result.formatted_address}`);
      console.log(`  - Lat/Lng: ${result.geometry.location.lat}, ${result.geometry.location.lng}`);
    }
    return '✅ PASS';
  } catch (err: any) {
    console.log(`  ❌ FAIL: ${err.message}`);
    return '❌ FAIL';
  }
}

async function testPlaceDetails() {
  console.log('\n=== Test 3: Places API (New) - Place Details ===');
  try {
    // First find a place
    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({ textQuery: 'factory Bangkok', pageSize: 1 }),
    });
    const searchData = await searchRes.json();
    const placeId = searchData.places?.[0]?.id;

    if (!placeId) {
      console.log('  ⚠️ No place found to test details');
      return '⚠️ SKIP';
    }

    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,websiteUri,nationalPhoneNumber,rating,userRatingCount',
      },
    });
    const data = await res.json();
    console.log(`  Status: ${res.status}`);
    console.log(`  - ${data.displayName?.text || 'N/A'}`);
    console.log(`  - Rating: ${data.rating || 'N/A'} (${data.userRatingCount || 0} reviews)`);
    return '✅ PASS';
  } catch (err: any) {
    console.log(`  ❌ FAIL: ${err.message}`);
    return '❌ FAIL';
  }
}

async function main() {
  console.log('🔍 Google Maps API 连通性验证');
  console.log(`API Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`);
  console.log('─'.repeat(60));

  const results = [
    await testPlacesSearchText(),
    await testGeocoding(),
    await testPlaceDetails(),
  ];

  console.log('\n' + '─'.repeat(60));
  console.log('📊 Summary:');
  results.forEach((r, i) => console.log(`  Test ${i + 1}: ${r}`));
  console.log('');
}

main();
