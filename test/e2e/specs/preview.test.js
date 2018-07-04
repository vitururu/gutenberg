/**
 * External dependencies
 */
import { parse } from 'url';

/**
 * Internal dependencies
 */
import '../support/bootstrap';
import {
	newPost,
	newDesktopBrowserPage,
	getUrl,
	publishPost,
} from '../support/utils';

describe( 'Preview', () => {
	beforeAll( async () => {
		await newDesktopBrowserPage();
	} );

	beforeEach( async () => {
		await newPost();
	} );

	let lastPreviewPage;

	/**
	 * Clicks the preview button and returns the generated preview window page,
	 * either the newly created tab or the redirected existing target. This is
	 * required because Chromium infuriatingly disregards same target name in
	 * specific undetermined circumstances, else our efforts to reuse the same
	 * popup have been fruitless and exhausting. It is worth exploring further,
	 * perhaps considering factors such as origin of the interstitial page (the
	 * about:blank placeholder screen).
	 *
	 * @return {Promise} Promise resolving with the focused preview page.
	 */
	async function getOpenedPreviewPage() {
		const race = [
			new Promise( ( resolve ) => {
				browser.once( 'targetcreated', async ( target ) => {
					resolve( await target.page() );
				} );
			} ),
		];

		if ( lastPreviewPage ) {
			race.push( new Promise( ( resolve ) => (
				lastPreviewPage.once( 'load', () => {
					resolve( lastPreviewPage );
				} )
			) ) );
		}

		const [ , previewPage ] = await Promise.all( [
			page.click( '.editor-post-preview' ),
			Promise.race( race ),
		] );

		lastPreviewPage = previewPage;

		await previewPage.bringToFront();

		return previewPage;
	}

	it( 'Should open a preview window for a new post', async () => {
		const editorPage = page;
		let previewPage;

		// Disabled until content present.
		const isPreviewDisabled = await page.$$eval(
			'.editor-post-preview:not( :disabled )',
			( enabledButtons ) => ! enabledButtons.length,
		);
		expect( isPreviewDisabled ).toBe( true );

		await editorPage.type( '.editor-post-title__input', 'Hello World' );

		previewPage = await getOpenedPreviewPage();

		// When autosave completes for a new post, the URL of the editor should
		// update to include the ID. Use this to assert on preview URL.
		const [ , postId ] = await ( await editorPage.waitForFunction( () => {
			return window.location.search.match( /[\?&]post=(\d+)/ );
		} ) ).jsonValue();

		let expectedPreviewURL = getUrl( '', `?p=${ postId }&preview=true` );
		await previewPage.waitForFunction( ( _expectedPreviewURL ) => {
			return window.location.href === _expectedPreviewURL;
		}, {}, expectedPreviewURL );

		// Title in preview should match input.
		let previewTitle = await previewPage.$eval( '.entry-title', ( node ) => node.textContent );
		expect( previewTitle ).toBe( 'Hello World' );

		// Return to editor to change title.
		await editorPage.bringToFront();
		await editorPage.type( '.editor-post-title__input', '!' );
		previewPage = await getOpenedPreviewPage();

		// Title in preview should match updated input.
		await previewPage.waitForFunction( () => {
			const title = document.querySelector( '.entry-title' );
			return title && title.textContent === 'Hello World!';
		} );

		// Pressing preview without changes should bring same preview window to
		// front and reload, but should not show interstitial.
		await editorPage.bringToFront();
		previewPage = await getOpenedPreviewPage();
		await previewPage.waitForNavigation();
		previewTitle = await previewPage.$eval( '.entry-title', ( node ) => node.textContent );
		expect( previewTitle ).toBe( 'Hello World!' );

		// Preview for published post (no unsaved changes) directs to canonical
		// URL for post.
		await editorPage.bringToFront();
		await publishPost();
		await Promise.all( [
			page.waitForFunction( () => ! document.querySelector( '.editor-post-preview' ) ),
			page.click( '.editor-post-publish-panel__header button' ),
		] );
		expectedPreviewURL = await editorPage.$eval( '.notice-success a', ( node ) => node.href );
		previewPage = await getOpenedPreviewPage();
		expect( previewPage.url() ).toBe( expectedPreviewURL );

		// Return to editor to change title.
		await editorPage.bringToFront();
		await editorPage.type( '.editor-post-title__input', ' And more.' );

		// Published preview should reuse same popup frame.
		previewPage = await getOpenedPreviewPage();

		// Title in preview should match updated input.
		await previewPage.waitForFunction( () => {
			const title = document.querySelector( '.entry-title' );
			return title && title.textContent === 'Hello World! And more.';
		} );

		// Published preview URL should include ID and nonce parameters.
		const { query } = parse( previewPage.url(), true );
		expect( query ).toHaveProperty( 'preview_id' );
		expect( query ).toHaveProperty( 'preview_nonce' );

		// Return to editor. Previewing already-autosaved preview tab should
		// reuse the opened tab, skipping interstitial. This resolves an edge
		// cases where the post is dirty but not autosaveable (because the
		// autosave is already up-to-date).
		//
		// See: https://github.com/WordPress/gutenberg/issues/7561
		await editorPage.bringToFront();
		previewPage = await getOpenedPreviewPage();

		// Preview page will reload. Wait for navigation to complete.
		await previewPage.waitForNavigation();

		// Title in preview should match updated input.
		previewTitle = await previewPage.$eval( '.entry-title', ( node ) => node.textContent );
		expect( previewTitle ).toBe( 'Hello World! And more.' );
	} );
} );
