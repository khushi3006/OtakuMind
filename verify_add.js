async function testAddAnime() {
  const anime1 = {
    name: "Test Anime 1",
    malId: 999991,
    status: "incomplete"
  };

  console.log("Adding first anime...");
  const res1 = await fetch('http://localhost:3000/api/anime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(anime1)
  });
  const data1 = await res1.json();
  console.log("Result 1:", data1);

  console.log("\nAdding same anime again...");
  const res2 = await fetch('http://localhost:3000/api/anime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(anime1)
  });
  const data2 = await res2.json();
  console.log("Result 2 (status 409 expected):", res2.status, data2);

  const anime2 = {
    name: "Test Anime 2",
    malId: 999992,
    status: "incomplete"
  };

  console.log("\nAdding second anime (should be on top)...");
  const res3 = await fetch('http://localhost:3000/api/anime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(anime2)
  });
  const data3 = await res3.json();
  console.log("Result 3:", data3);
  
  if (data3.watchOrder < data1.watchOrder) {
    console.log("\nSUCCESS: Second anime has smaller watchOrder than first.");
  } else {
    console.log("\nFAILURE: Second anime watchOrder is not smaller than first.");
  }
}

testAddAnime();
