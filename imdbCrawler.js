const cheerio = require('cheerio');
const url = require('url');

const axios = require('./axios');
const esClient = require('./elasticsearch');

class IMDBCrawler {
	constructor(url) {
		const seedUrls = [
      'movies-coming-soon',
      'movies-in-theaters',
      'chart/top',
      'chart/boxoffice',
      'chart/moviemeter',
      'chart/top-english-movies',
      'chart/bottom'
    ];

		this.seedUrls = seedUrls.map(seedUrl => `${url}/${seedUrl}`);
	}

	async extractMoviesLinks(seedUrl) {
		const { data } = await axios.get(seedUrl);
		const $ = cheerio.load(data);
		const moviesLinks = [];

		$('#main a[title]').each((i, element) => {
			const link = url.parse($(element).attr('href'));
			const title = $(element).attr('title');
			const linkPaths = link.pathname.split('/').filter(Boolean);

			if (linkPaths[0] === 'title' && title !== 'Delete') {
				moviesLinks.push(linkPaths[1]);
			}
		});

		return moviesLinks;
	}

	async extractMovieDetails(movieId) {
		const { data } = await axios.get(`/title/${movieId}`);
		const $ = cheerio.load(data);
		const content = $('#content-2-wide');
		const details = {};

		const titleAndYear = content.find('#titleYear').parent();
		details.year = Number(titleAndYear.find('a').text());
		titleAndYear.find('#titleYear').remove();
		details.name = titleAndYear.text().trim();
		details.rating = Number(content.find('div.ratingValue strong span').text());
		details.image = content.find('div.poster a img').attr('src');

		const summary = content.find('div.plot_summary');
		details.summary = summary
			.find('.summary_text')
			.text()
			.trim();
		details.director = summary
			.children()
			.eq(1)
			.find('a')
			.first()
			.text();
		details.writer = summary
			.children()
			.eq(2)
			.find('a')
			.first()
			.text();

		details.stars = [];
		const stars = summary
			.children()
			.eq(3)
			.find('a');
		stars.each((i, element) => {
			if (i !== stars.length - 1) details.stars.push($(element).text());
		});

		details.metascore = Number(content.find('.metacriticScore span').text());

		details.genres = [];
		const genres = content
			.find('#titleStoryLine div:contains("Genres")')
			.find('a');
		genres.each((i, element) => {
			details.genres.push(
				$(element)
				.text()
				.trim()
			);
		});

		return details;
	}

	async crawlAndIndex() {
		const movieIDs = [];
		const movieDetails = [];

		let seedUrl;
		while (this.seedUrls.length) {
			try {
				seedUrl = this.seedUrls.shift();
				console.log(`Extracting links from: ${seedUrl}`);
				const links = await this.extractMoviesLinks(seedUrl);

				movieIDs.push(...links);
			} catch (err) {
				console.error(err.message);
				this.seedUrls.push(seedUrl);
			}
		}

		console.log(`Found ${movieIDs.length} links...`);

		let movieID;
		while (movieIDs.length) {
			try {
				movieID = movieIDs.shift();
				console.log(`Requesting ${movieID}...`);
				const details = await this.extractMovieDetails(movieID);

				console.log('Got: ', details);
				await esClient.index({
					index: 'movies',
					id: movieID.substring(2),
					body: details
				});

				console.log(movieID, 'Indexed');
				movieDetails.push(details);
			} catch (err) {
				console.error(err.message);
				movieIDs.push(movieID);
			}
		}

		return movieDetails;
	}
}

module.exports = IMDBCrawler;