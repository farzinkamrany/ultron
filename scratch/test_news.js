async function getNews() {
  try {
    const res = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN');
    const data = await res.json();
    console.log("Status:", data.Message);
    console.log("Top 3 News Titles:");
    data.Data.slice(0,3).forEach((n, i) => {
      console.log(`\n${i+1}. ${n.title}`);
      console.log(`   ${n.body.substring(0, 50)}...`);
    });
  } catch(e) {
    console.error(e);
  }
}
getNews();
