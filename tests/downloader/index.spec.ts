import Downloader from '../../src/downloader'; // Adjust path as per your structure
import axios from 'axios';
import *s cheerio from 'cheerio'; // Import all as cheerio

// Mock axios and cheerio
jest.mock('axios');
// Cheerio is more complex to mock deeply for all chained calls.
// We'll mock specific cheerio functions as needed or use a lighter approach.
// For cheerio.load, we'll mock it to return a mocked $ instance.
const mockCheerioLoad = jest.fn();
jest.mock('cheerio', () => ({
    ...jest.requireActual('cheerio'), // Import actual cheerio and overwrite load
    load: (html: string) => mockCheerioLoad(html),
}));


describe('Downloader - getVideoPostsFromPage', () => {
    let downloader: Downloader;
    const MOCKED_BASE_URL = 'https://www.sakugabooru.com';

    beforeEach(() => {
        jest.clearAllMocks(); // Clears mock usage data between tests
        downloader = new Downloader(MOCKED_BASE_URL); // Initialize with a base URL
        // Reset console spy/mocks if any were set up globally, or do it per test.
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks(); // Restore original console functions
    });

    const mockHtmlWithPosts = (posts: { href: string }[], nextPageHref?: string) => {
        const linksHtml = posts.map(p => `<a href="${p.href}">Post</a>`).join('');
        const nextLinkHtml = nextPageHref ? `<a rel="next" href="${nextPageHref}">Next</a>` : '';
        return `
            <html><body>
                <ul id="post-list-posts">${linksHtml}</ul>
                <div class="paginator">${nextLinkHtml}</div>
            </body></html>
        `;
    };
    
    const mockHtmlNoPostsMessage = () => {
        return `<html><body><div id="content"><h1>No posts found</h1></div></body></html>`;
    };

    const mockHtmlEmpty = () => {
        return `<html><body><ul id="post-list-posts"></ul></body></html>`;
    };

    it('should fetch posts and identify a next page link', async () => {
        const pageUrl = `${MOCKED_BASE_URL}/post?tags=test&page=1`;
        const postsData = [{ href: '/post/show/123' }, { href: '/post/show/456' }];
        const nextPageLink = '/post?tags=test&page=2';
        const html = mockHtmlWithPosts(postsData, nextPageLink);

        (axios.get as jest.Mock).mockResolvedValue({ data: html });
        
        const mock$Instance = {
            find: jest.fn().mockReturnThis(), // For chaining if used, though not in current downloader
            each: jest.fn((callback) => {
                postsData.forEach((post, index) => {
                    const element = { attr: jest.fn().mockReturnValue(post.href) };
                    callback(index, element);
                });
                return mock$Instance; // Return self for chaining if any
            }),
            attr: jest.fn((attrName) => { // For next page link
                if (attrName === 'href') return nextPageLink;
                return undefined;
            }),
            // Mock other cheerio functions as needed by your implementation
            '#post-list-posts li a[href*="/post/show/"]': { // Direct selector access
                each: jest.fn((callback) => {
                     postsData.forEach((post, index) => {
                        const element = { attr: jest.fn().mockReturnValue(post.href) };
                        callback(index, element);
                    });
                })
            },
            'a[rel="next"]': { // Selector for next page link
                attr: jest.fn().mockReturnValue(nextPageLink)
            },
             '.paginator a.next_page': { // Alternative selector for next page link
                attr: jest.fn().mockReturnValue(undefined) // Simulate not found by this selector
            }
        };
        mockCheerioLoad.mockReturnValue(mock$Instance);


        const result = await downloader.getVideoPostsFromPage(pageUrl);

        expect(axios.get).toHaveBeenCalledWith(pageUrl, expect.any(Object));
        expect(mockCheerioLoad).toHaveBeenCalledWith(html);
        expect(result).toEqual([
            `${MOCKED_BASE_URL}/post/show/123`,
            `${MOCKED_BASE_URL}/post/show/456`,
        ]);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 2 posts'));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`A 'next page' link was found: ${nextPageLink}`));
    });

    it('should fetch posts when no next page link is present', async () => {
        const pageUrl = `${MOCKED_BASE_URL}/post?tags=final_page`;
        const postsData = [{ href: '/post/show/789' }];
        const html = mockHtmlWithPosts(postsData); // No next page link

        (axios.get as jest.Mock).mockResolvedValue({ data: html });
        mockCheerioLoad.mockReturnValue({
            '#post-list-posts li a[href*="/post/show/"]': {
                each: jest.fn((callback) => {
                    postsData.forEach((post, index) => {
                        const element = { attr: jest.fn().mockReturnValue(post.href) };
                        callback(index, element);
                    });
                })
            },
            'a[rel="next"]': { attr: jest.fn().mockReturnValue(undefined) },
            '.paginator a.next_page': { attr: jest.fn().mockReturnValue(undefined) }
        });

        const result = await downloader.getVideoPostsFromPage(pageUrl);
        expect(result).toEqual([`${MOCKED_BASE_URL}/post/show/789`]);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 1 posts'));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No \'next page\' link found. This might be the last page'));
    });
    
    it('should handle page with "No posts found" message', async () => {
        const pageUrl = `${MOCKED_BASE_URL}/post?tags=empty_tag`;
        const html = mockHtmlNoPostsMessage();

        (axios.get as jest.Mock).mockResolvedValue({ data: html });
        mockCheerioLoad.mockReturnValue({
            '#post-list-posts li a[href*="/post/show/"]': { each: jest.fn() }, // No posts
            'a[rel="next"]': { attr: jest.fn().mockReturnValue(undefined) },
            '.paginator a.next_page': { attr: jest.fn().mockReturnValue(undefined) },
            '#content h1': { text: jest.fn().mockReturnValue('No posts found for this tag') }
        });
        
        const result = await downloader.getVideoPostsFromPage(pageUrl);
        expect(result).toEqual([]);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No posts found on'));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('and no \'next page\' link. This is likely the end'));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Confirmed: Page content indicates 'No posts found'"));
    });

    it('should handle an empty page (no posts, no specific message, no next link)', async () => {
        const pageUrl = `${MOCKED_BASE_URL}/post?tags=very_empty_tag`;
        const html = mockHtmlEmpty();

        (axios.get as jest.Mock).mockResolvedValue({ data: html });
        mockCheerioLoad.mockReturnValue({
            '#post-list-posts li a[href*="/post/show/"]': { each: jest.fn() },
            'a[rel="next"]': { attr: jest.fn().mockReturnValue(undefined) },
            '.paginator a.next_page': { attr: jest.fn().mockReturnValue(undefined) },
            '#content h1': { text: jest.fn().mockReturnValue('') } // No specific message
        });

        const result = await downloader.getVideoPostsFromPage(pageUrl);
        expect(result).toEqual([]);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No posts found on'));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('and no \'next page\' link. This is likely the end'));
    });
    
    it('should handle HTML parsing failure from Cheerio', async () => {
        const pageUrl = `${MOCKED_BASE_URL}/post?tags=broken_html`;
        (axios.get as jest.Mock).mockResolvedValue({ data: "<html>unclosed tag" });
        
        // Simulate cheerio.load throwing an error
        mockCheerioLoad.mockImplementation(() => { 
            throw new Error('Failed to parse HTML'); 
        });

        const result = await downloader.getVideoPostsFromPage(pageUrl);
        expect(result).toEqual([]);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`Error getting posts from page ${pageUrl}: Failed to parse HTML`));
    });

    it('should handle Axios GET request failure', async () => {
        const pageUrl = `${MOCKED_BASE_URL}/post?tags=network_error`;
        const error = { 
            isAxiosError: true, 
            response: { status: 500, data: "Server Error" }, 
            message: "Request failed with status code 500" 
        };
        (axios.get as jest.Mock).mockRejectedValue(error);

        const result = await downloader.getVideoPostsFromPage(pageUrl);
        expect(result).toEqual([]);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`HTTP error 500 while fetching posts from ${pageUrl}: Server response snippet: Server Error. Request failed with status code 500`));
    });
    
    it('should handle invalid URL input', async () => {
        const invalidUrl = 'htp:/invalid-url';
        // No need to mock axios or cheerio as validateUrl should catch this first.
        const result = await downloader.getVideoPostsFromPage(invalidUrl);
        expect(result).toEqual([]);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`Error getting posts from page ${invalidUrl}: Invalid URL`));
    });

    it('should warn if no posts found but a next page link exists', async () => {
        const pageUrl = `${MOCKED_BASE_URL}/post?tags=empty_but_next`;
        const nextPageLink = '/post?tags=empty_but_next&page=2';
        const html = mockHtmlWithPosts([], nextPageLink); // No posts, but next link

        (axios.get as jest.Mock).mockResolvedValue({ data: html });
        mockCheerioLoad.mockReturnValue({
            '#post-list-posts li a[href*="/post/show/"]': { each: jest.fn() }, // No posts
            'a[rel="next"]': { attr: jest.fn().mockReturnValue(nextPageLink) },
            '.paginator a.next_page': { attr: jest.fn().mockReturnValue(undefined) },
            '#content h1': { text: jest.fn().mockReturnValue('') }
        });

        const result = await downloader.getVideoPostsFromPage(pageUrl);
        expect(result).toEqual([]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`No posts found on ${pageUrl}, but a 'next page' link exists`));
    });

});

describe('Downloader - getVideoUrlFromPost', () => {
    let downloader: Downloader;
    const MOCKED_BASE_URL = 'https://www.sakugabooru.com';

    beforeEach(() => {
        jest.clearAllMocks();
        downloader = new Downloader(MOCKED_BASE_URL);
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const mockHtmlWithVideo = (videoSrc: string) => `<html><body><video><source src="${videoSrc}"></video></body></html>`;
    const mockHtmlNoVideo = () => `<html><body><p>No video here</p></body></html>`;

    it('should extract video URL from post page', async () => {
        const postUrl = `${MOCKED_BASE_URL}/post/show/100`;
        const videoSrc = '/path/to/video.mp4';
        const html = mockHtmlWithVideo(videoSrc);

        (axios.get as jest.Mock).mockResolvedValue({ data: html });
        mockCheerioLoad.mockReturnValue({
            'video source': { first: jest.fn().mockReturnThis(), attr: jest.fn().mockReturnValue(videoSrc), length: 1 }
        });
        
        const result = await downloader.getVideoUrlFromPost(postUrl);

        expect(axios.get).toHaveBeenCalledWith(postUrl, expect.any(Object));
        expect(mockCheerioLoad).toHaveBeenCalledWith(html);
        expect(result).toBe(`${MOCKED_BASE_URL}${videoSrc}`); // Assuming relative URL
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Fetching video URL from ${postUrl}`));
    });

    it('should return null if no video source is found', async () => {
        const postUrl = `${MOCKED_BASE_URL}/post/show/101`;
        const html = mockHtmlNoVideo();

        (axios.get as jest.Mock).mockResolvedValue({ data: html });
        mockCheerioLoad.mockReturnValue({
            'video source': { first: jest.fn().mockReturnThis(), attr: jest.fn(), length: 0 } // No source found
        });

        const result = await downloader.getVideoUrlFromPost(postUrl);
        expect(result).toBeNull();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Fetching video URL from ${postUrl}`));
    });
    
    it('should return null on Axios error', async () => {
        const postUrl = `${MOCKED_BASE_URL}/post/show/102`;
        (axios.get as jest.Mock).mockRejectedValue(new Error('Network Error'));

        const result = await downloader.getVideoUrlFromPost(postUrl);
        expect(result).toBeNull();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`Error getting video URL from post ${postUrl}`), expect.any(Error));
    });

    it('should return null on Cheerio parsing error', async () => {
        const postUrl = `${MOCKED_BASE_URL}/post/show/103`;
        (axios.get as jest.Mock).mockResolvedValue({ data: "bad html" });
        mockCheerioLoad.mockImplementation(() => { throw new Error('Parsing failed'); });

        const result = await downloader.getVideoUrlFromPost(postUrl);
        expect(result).toBeNull();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`Failed to parse HTML from ${postUrl}`), expect.any(Error));
    });
     it('should handle invalid URL for post', async () => {
        const invalidUrl = 'htp:/invalid-url';
        const result = await downloader.getVideoUrlFromPost(invalidUrl);
        expect(result).toBeNull();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`Error getting video URL from post ${invalidUrl}: Invalid URL`));
    });
});

// Mock fs for _processSinglePostForTag if it tries to interact with the filesystem directly
// For now, _processSinglePostForTag primarily calls other mockable methods or network requests.
// jest.mock('fs', () => ({
//   ...jest.requireActual('fs'), // import and retain default behavior
//   existsSync: jest.fn(),
//   mkdirSync: jest.fn(),
//   createWriteStream: jest.fn().mockReturnValue({
//     on: jest.fn((event, handler) => {
//       if (event === 'finish') setTimeout(handler, 10); // Simulate async write
//       return this;
//     }),
//     pipe: jest.fn(),
//   }),
//   statSync: jest.fn().mockReturnValue({ size: 1024 }),
//   unlink: jest.fn()
// }));


describe('Downloader - _processSinglePostForTag', () => {
    let downloader: Downloader;
    const MOCKED_BASE_URL = 'https://www.sakugabooru.com';
    const mockOutputDir = 'output/downloads_test';

    beforeEach(() => {
        jest.clearAllMocks();
        // Note: concurrentDownloadsLimit can be passed to constructor if needed for specific tests
        downloader = new Downloader(MOCKED_BASE_URL, mockOutputDir); 
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        
        // Mock methods called by _processSinglePostForTag
        jest.spyOn(downloader, 'getVideoUrlFromPost').mockResolvedValue(null); // Default mock
         // Mock fs, specifically for file operations within _processSinglePostForTag
        (fs.existsSync as jest.Mock).mockReturnValue(false); // Default: file does not exist
        (fs.mkdirSync as jest.Mock).mockClear();
        (fs.statSync as jest.Mock).mockReturnValue({ size: 12345 }); // Mock file size
        
        // Mock axios for the actual download part within _processSinglePostForTag
        // This simulates the stream download
        const mockStream = {
            on: jest.fn((event, handler) => {
                if (event === 'data') { /* can simulate chunks if needed */ }
                if (event === 'end' || event === 'finish') { // Axios uses 'data' and 'end', fs.WriteStream uses 'finish'
                     setTimeout(handler, 0); // Simulate async behavior
                }
                return mockStream;
            }),
            pipe: jest.fn().mockReturnThis(mockStream) // Ensure 'this' is returned for chaining
        };
        (axios as unknown as jest.Mock).mockResolvedValue({ data: mockStream, headers: { 'content-length': '102400' } });

        // Mock fs.createWriteStream specifically
        const mockFsWriteStream = {
            on: jest.fn((event, handler) => {
                if (event === 'finish') setTimeout(handler, 10); // Simulate async write
                if (event === 'error') { /* can simulate error */ }
                return mockFsWriteStream;
            }),
            pipe: jest.fn(),
        };
        (fs.createWriteStream as jest.Mock).mockReturnValue(mockFsWriteStream);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should process a single post, download video, and emit events', async () => {
        const postUrl = `${MOCKED_BASE_URL}/post/show/200`;
        const videoUrl = `${MOCKED_BASE_URL}/path/to/actual_video.mp4`;
        const tag = 'test_tag';
        const videoNumber = 1;

        (downloader.getVideoUrlFromPost as jest.Mock).mockResolvedValue(videoUrl);
        (fs.existsSync as jest.Mock).mockReturnValue(false); // File doesn't exist yet

        const emitSpy = jest.spyOn(downloader, 'emit');

        // Access the private method for testing (common in JS/TS testing)
        const resultPath = await (downloader as any)._processSinglePostForTag(postUrl, tag, mockOutputDir, videoNumber);

        expect(downloader.getVideoUrlFromPost).toHaveBeenCalledWith(postUrl);
        expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining(`${tag}_${videoNumber}.mp4`));
        expect(axios).toHaveBeenCalledWith(expect.objectContaining({ url: videoUrl, method: 'GET', responseType: 'stream' }));
        expect(fs.createWriteStream).toHaveBeenCalledWith(expect.stringContaining(`${tag}_${videoNumber}.mp4`));
        expect(resultPath).toContain(`${tag}_${videoNumber}.mp4`);

        expect(emitSpy).toHaveBeenCalledWith('downloadProgress', expect.objectContaining({ status: 'downloading', postUrl }));
        expect(emitSpy).toHaveBeenCalledWith('downloadComplete', expect.objectContaining({ status: 'complete', postUrl, fileName: `${tag}_${videoNumber}.mp4` }));
    });

    it('should skip download if file already exists', async () => {
        const postUrl = `${MOCKED_BASE_URL}/post/show/201`;
        const videoUrl = `${MOCKED_BASE_URL}/path/to/existing_video.mp4`;
        const tag = 'test_tag_exists';
        const videoNumber = 2;

        (downloader.getVideoUrlFromPost as jest.Mock).mockResolvedValue(videoUrl);
        (fs.existsSync as jest.Mock).mockReturnValue(true); // File *does* exist

        const emitSpy = jest.spyOn(downloader, 'emit');
        
        const resultPath = await (downloader as any)._processSinglePostForTag(postUrl, tag, mockOutputDir, videoNumber);

        expect(downloader.getVideoUrlFromPost).toHaveBeenCalledWith(postUrl);
        expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining(`${tag}_${videoNumber}.mp4`));
        expect(axios).not.toHaveBeenCalled(); // Download should not happen
        expect(resultPath).toContain(`${tag}_${videoNumber}.mp4`);
        expect(emitSpy).toHaveBeenCalledWith('downloadComplete', expect.objectContaining({ message: expect.stringContaining('Archivo ya existe') }));
    });
    
    it('should return null if getVideoUrlFromPost returns null', async () => {
        const postUrl = `${MOCKED_BASE_URL}/post/show/202`;
        const tag = 'test_tag_no_video_url';
        const videoNumber = 3;

        (downloader.getVideoUrlFromPost as jest.Mock).mockResolvedValue(null);
        
        const resultPath = await (downloader as any)._processSinglePostForTag(postUrl, tag, mockOutputDir, videoNumber);
        expect(resultPath).toBeNull();
        expect(axios).not.toHaveBeenCalled();
    });

    it('should handle errors during download stream', async () => {
        const postUrl = `${MOCKED_BASE_URL}/post/show/203`;
        const videoUrl = `${MOCKED_BASE_URL}/path/to/error_video.mp4`;
        const tag = 'test_tag_stream_error';
        const videoNumber = 4;

        (downloader.getVideoUrlFromPost as jest.Mock).mockResolvedValue(videoUrl);
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        
        const streamError = new Error('Stream write error');
        const mockErrorStream = {
            on: jest.fn((event, handler) => {
                if (event === 'error') handler(streamError); // Simulate error event on writer
                return mockErrorStream;
            }),
            pipe: jest.fn(),
        };
        (fs.createWriteStream as jest.Mock).mockReturnValue(mockErrorStream);
        (fs.unlink as jest.Mock).mockImplementation((path, cb) => cb()); // Mock unlink

        const emitSpy = jest.spyOn(downloader, 'emit');

        await expect((downloader as any)._processSinglePostForTag(postUrl, tag, mockOutputDir, videoNumber))
            .rejects.toThrow('Stream write error');
        
        expect(emitSpy).toHaveBeenCalledWith('downloadError', expect.objectContaining({ message: expect.stringContaining(streamError.message) }));
        expect(fs.unlink).toHaveBeenCalled(); // Check if partial file deletion was attempted
    });
});


describe('Downloader - downloadVideosFromTag', () => {
    let downloader: Downloader;
    const MOCKED_BASE_URL = 'https://www.sakugabooru.com';
    const mockOutputDir = 'output/downloads_test_tag';

    beforeEach(() => {
        downloader = new Downloader(MOCKED_BASE_URL, mockOutputDir, 2); // Concurrency limit of 2 for testing
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(downloader as any, 'sleep').mockResolvedValue(undefined); // Mock sleep to speed up tests
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should process posts from multiple pages concurrently and respect limit', async () => {
        const tagUrl = `${MOCKED_BASE_URL}/post?tags=concurrent_test`;
        const page1Posts = ['/post/show/c1', '/post/show/c2', '/post/show/c3'];
        const page2Posts = ['/post/show/c4', '/post/show/c5'];

        // Mock getVideoPostsFromPage
        const mockGetVideoPostsFromPage = jest.spyOn(downloader, 'getVideoPostsFromPage')
            .mockResolvedValueOnce(page1Posts.map(p => MOCKED_BASE_URL + p)) // Page 1
            .mockResolvedValueOnce(page2Posts.map(p => MOCKED_BASE_URL + p)) // Page 2
            .mockResolvedValueOnce([]); // Page 3 (empty, to stop pagination)

        let activeConcurrentCalls = 0;
        let maxConcurrentCalls = 0;
        const processedVideoNumbers: number[] = [];

        // Mock _processSinglePostForTag
        const mockProcessSinglePost = jest.spyOn(downloader as any, '_processSinglePostForTag')
            .mockImplementation(async (postUrl: string, tag: string, outputDir: string, videoNumber: number) => {
                activeConcurrentCalls++;
                maxConcurrentCalls = Math.max(maxConcurrentCalls, activeConcurrentCalls);
                processedVideoNumbers.push(videoNumber);
                
                // Simulate async work with varying delays
                const delay = Math.random() * 50 + 10; // 10-60ms
                await new Promise(resolve => setTimeout(resolve, delay));
                
                activeConcurrentCalls--;
                return `${outputDir}/${tag}_${videoNumber}.mp4`; // Simulate successful download path
            });

        const results = await downloader.downloadVideosFromTag(tagUrl, mockOutputDir);

        expect(mockGetVideoPostsFromPage).toHaveBeenCalledTimes(3);
        expect(mockGetVideoPostsFromPage).toHaveBeenNthCalledWith(1, `${tagUrl}&page=1`);
        expect(mockGetVideoPostsFromPage).toHaveBeenNthCalledWith(2, `${tagUrl}&page=2`);
        expect(mockGetVideoPostsFromPage).toHaveBeenNthCalledWith(3, `${tagUrl}&page=3`);
        
        expect(mockProcessSinglePost).toHaveBeenCalledTimes(page1Posts.length + page2Posts.length); // 3 + 2 = 5 posts
        
        // Check concurrency limit
        expect(maxConcurrentCalls).toBeLessThanOrEqual(2); // Downloader concurrency limit set to 2
        expect(maxConcurrentCalls).toBeGreaterThan(0); // Ensure it actually ran something

        // Check video counter logic (should be 1, 2, 3, 4, 5)
        expect(processedVideoNumbers.sort((a,b) => a-b)).toEqual([1, 2, 3, 4, 5]);
        
        // Check results paths
        expect(results.length).toBe(page1Posts.length + page2Posts.length);
        expect(results[0]).toContain('_1.mp4'); // First video from first page
        expect(results[results.length -1]).toContain('_5.mp4'); // Last video from last page

        // Check sleep was called between pages with content
        expect((downloader as any).sleep).toHaveBeenCalledTimes(2); // After page 1, after page 2
    });
    
    it('should reset videoCounter for a new tag processing', async () => {
        const tag1Url = `${MOCKED_BASE_URL}/post?tags=tag1`;
        const tag2Url = `${MOCKED_BASE_URL}/post?tags=tag2`;
        const page1Posts = ['/post/show/t1p1', '/post/show/t1p2'];
        const page2Posts = ['/post/show/t2p1'];

        jest.spyOn(downloader, 'getVideoPostsFromPage')
            .mockResolvedValueOnce(page1Posts.map(p => MOCKED_BASE_URL + p))
            .mockResolvedValueOnce([]) // End of tag1
            .mockResolvedValueOnce(page2Posts.map(p => MOCKED_BASE_URL + p))
            .mockResolvedValueOnce([]); // End of tag2
        
        const processedVideoNumbersForTag1: number[] = [];
        const processedVideoNumbersForTag2: number[] = [];

        jest.spyOn(downloader as any, '_processSinglePostForTag')
            .mockImplementation(async (postUrl: string, tag: string, outputDir: string, videoNumber: number) => {
                if (tag === 'tag1') processedVideoNumbersForTag1.push(videoNumber);
                if (tag === 'tag2') processedVideoNumbersForTag2.push(videoNumber);
                await new Promise(r => setTimeout(r, 10));
                return `${outputDir}/${tag}_${videoNumber}.mp4`;
            });

        await downloader.downloadVideosFromTag(tag1Url, mockOutputDir);
        expect(processedVideoNumbersForTag1.sort((a,b)=>a-b)).toEqual([1, 2]);
        
        // When downloadVideosFromTag is called again (simulating a new operation), videoCounter should reset.
        // The instance 'downloader' retains its state, so videoCounter would normally continue.
        // The reset is at the beginning of downloadVideosFromTag.
        await downloader.downloadVideosFromTag(tag2Url, mockOutputDir);
        expect(processedVideoNumbersForTag2.sort((a,b)=>a-b)).toEqual([1]); 
    });

});
});
