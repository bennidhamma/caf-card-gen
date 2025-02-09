import fs from 'fs/promises';
import path from 'path';
import { load } from 'cheerio';
import type * as cheerio from 'cheerio';
import { parse } from 'csv-parse';

interface CardData {
    title: string;
    backtext: string;
    level?: string;
    photo_url?: string;
    bg_color?: string;
    [key: string]: string | undefined;
}

interface SVGSelectors {
    title: string;
    backtext: string;
    photo: string;
    background: string;
    [key: string]: string;
}

const DEFAULT_SELECTORS: SVGSelectors = {
    title: '#card-title',
    backtext: '#card-backtext',
    photo: '#card-photo',
    background: '#card-background'
};

interface TextStyles {
    titleBgColor: string;
    boldColor: string;
}

const DEFAULT_STYLES: TextStyles = {
    titleBgColor: '#FFFFFF',
    boldColor: '#c68411'
};

interface TextBlock {
    type: 'h2' | 'paragraph' | 'bullet';
    content: Array<{ text: string; isBold: boolean }>;
}

class CardGenerator {
    private template: string = '';
    private $: ReturnType<typeof load> | null = null;

    constructor(
        private selectors: SVGSelectors = DEFAULT_SELECTORS,
        private styles: TextStyles = DEFAULT_STYLES
    ) {}

    async loadTemplate(templatePath: string): Promise<void> {
        this.template = await fs.readFile(templatePath, 'utf-8');
        this.$ = load(this.template, {
            xmlMode: true
        });
    }

    async processCSV(csvPath: string): Promise<CardData[]> {
        const csvContent = await fs.readFile(csvPath, 'utf-8');
        return new Promise((resolve, reject) => {
            parse(csvContent, {
                columns: true,
                skip_empty_lines: true
            }, (err, data) => {
                if (err) reject(err);
                else resolve(data as CardData[]);
            });
        });
    }

    private parseMarkdownToBlocks(text: string): TextBlock[] {
        const blocks: TextBlock[] = [];
        const lines = text.split('\n');
        let currentParagraph: string[] = [];

        const flushParagraph = () => {
            if (currentParagraph.length > 0) {
                blocks.push({
                    type: 'paragraph',
                    content: this.parseInlineFormatting(currentParagraph.join(' '))
                });
                currentParagraph = [];
            }
        };

        lines.forEach(line => {
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('## ')) {
                // Header
                flushParagraph();
                blocks.push({
                    type: 'h2',
                    content: this.parseInlineFormatting(trimmedLine.slice(3))
                });
            } else if (trimmedLine.startsWith('* ')) {
                // Bullet point
                flushParagraph();
                blocks.push({
                    type: 'bullet',
                    content: this.parseInlineFormatting(trimmedLine.slice(2))
                });
            } else if (trimmedLine === '') {
                // Empty line
                flushParagraph();
            } else {
                // Part of a paragraph
                currentParagraph.push(trimmedLine);
            }
        });

        flushParagraph(); // Don't forget the last paragraph
        return blocks;
    }

    private parseInlineFormatting(text: string): Array<{ text: string; isBold: boolean }> {
        const segments: Array<{ text: string; isBold: boolean }> = [];
        let currentIndex = 0;

        const boldPattern = /(\*\*|__)(.*?)\1/g;
        let match;

        while ((match = boldPattern.exec(text)) !== null) {
            if (match.index > currentIndex) {
                segments.push({
                    text: text.slice(currentIndex, match.index),
                    isBold: false
                });
            }

            segments.push({
                text: match[2],
                isBold: true
            });

            currentIndex = match.index + match[0].length;
        }

        if (currentIndex < text.length) {
            segments.push({
                text: text.slice(currentIndex),
                isBold: false
            });
        }

        return segments;
    }

private createTextContent($textElement: cheerio.Cheerio, blocks: TextBlock[]) {
    if (!this.$) throw new Error('Template not loaded');

    // Clear existing content
    $textElement.empty();

    // Get basic text properties from the template
    const baseX = Number($textElement.attr('x') || '3');
    const baseY = Number($textElement.attr('y') || '21');
    
    // Extract font size from the style attribute or font-size attribute
    const styleAttr = $textElement.attr('style') || '';
    const fontSizeMatch = styleAttr.match(/font-size:([\d.]+)px/);
    const fontSize = fontSizeMatch 
        ? Number(fontSizeMatch[1])
        : Number($textElement.attr('font-size') || '8.46667');

    console.log('Using font size:', fontSize); // Debug log

    const lineHeight = fontSize * 1.2;
    const maxWidth = 120 * 1.2;
    const avgCharWidth = fontSize * 0.5;

    // Helper to estimate text width
    const estimateWidth = (text: string) => text.length * avgCharWidth;

    // Helper to create a new line tspan
    const createLineTspan = (
        atY: number,
        blockType: TextBlock['type'],
        includesBullet: boolean = false
    ) => {
        const $line = this.$!('<tspan>')
            .attr('x', String(blockType === 'bullet' ? baseX + 5 : baseX))
            .attr('y', String(atY));

        switch (blockType) {
            case 'h2':
                $line
                    .attr('font-weight', 'bold')
                    .attr('text-anchor', 'middle')
                    .attr('x', String(baseX + maxWidth / 2));
                break;
            case 'paragraph':
                $line
                    .attr('text-anchor', 'middle')
                    .attr('x', String(baseX + maxWidth / 2));
                break;
            case 'bullet':
                $line.attr('text-anchor', 'start');
                if (includesBullet) {
                    this.$!('<tspan>').text('• ').appendTo($line);
                }
                break;
        }
        return $line;
    };

    let currentY = baseY + fontSize; // Start with space for the first line
    let firstInBlock = true;

    blocks.forEach(block => {
        if (!firstInBlock) {
            // Add extra spacing between blocks
            currentY += lineHeight * (block.type === 'bullet' ? 0.3 : 0.6);
        }
        firstInBlock = false;

        let currentLine: Array<cheerio.Cheerio> = [];
        let currentLineWidth = 0;
        let linesInCurrentBlock = 0;
        let $currentTspan = createLineTspan(currentY, block.type, true);

        // Process each content segment
        block.content.forEach(segment => {
            const words = segment.text.split(/\s+/);
            
            words.forEach((word, wordIndex) => {
                const wordWidth = estimateWidth(word);
                const spaceWidth = estimateWidth(' ');
                const isFirstWord = wordIndex === 0 && currentLine.length === 0;
                
                // Check if we need to start a new line
                if (!isFirstWord && currentLineWidth + wordWidth + spaceWidth > maxWidth) {
                    // Append current line to the text element
                    $textElement.append($currentTspan);
                    
                    // Start new line
                    linesInCurrentBlock++;
                    currentY += lineHeight;
                    $currentTspan = createLineTspan(currentY, block.type);
                    currentLine = [];
                    currentLineWidth = 0;
                }

                // Add space between words if needed
                if (!isFirstWord) {
                    this.$!('<tspan>').text(' ').appendTo($currentTspan);
                    currentLineWidth += spaceWidth;
                }

                // Add the word with proper formatting
                const $wordSpan = this.$!('<tspan>');
                if (segment.isBold) {
                    $wordSpan
                        .attr('fill', this.styles.boldColor)
                        .attr('font-weight', 'bold');
                }
                $wordSpan.text(word);
                $currentTspan.append($wordSpan);
                
                currentLine.push($wordSpan);
                currentLineWidth += wordWidth;
            });
        });

        // Don't forget to append the last line
        if ($currentTspan) {
            $textElement.append($currentTspan);
            currentY += lineHeight;  // Account for the height of the last line
        }
    });
}

    generateCard(data: CardData): string {
        if (!this.$) throw new Error('Template not loaded');
        
        const $ = load(this.template, { xmlMode: true });

        if (data.title) {
            const $titleElement = $(this.selectors.title);
            $titleElement
                .text(data.title.toUpperCase())
                .attr('fill', this.styles.titleBgColor);
            // Keep existing text-anchor and positioning from template
        }

        if (data.backtext) {
            const $backtextElement = $(this.selectors.backtext);
            const blocks = this.parseMarkdownToBlocks(data.backtext);
            this.createTextContent($backtextElement, blocks);
        }

        if (data.photo_url && this.selectors.photo) {
            $(this.selectors.photo).attr('xlink:href', data.photo_url);
        }

        if (data.bg_color && this.selectors.background) {
            $(this.selectors.background).attr('fill', data.bg_color);
        }

        return $.html();
    }

    async generateCards(csvPath: string, outputDir: string): Promise<void> {
        const cards = await this.processCSV(csvPath);
        
        await fs.mkdir(outputDir, { recursive: true });

        for (const card of cards) {
            const svg = this.generateCard(card);
            const filename = `card_${card.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.svg`;
            await fs.writeFile(path.join(outputDir, filename), svg);
        }
    }
}

async function main() {
    try {
        const generator = new CardGenerator(
            DEFAULT_SELECTORS,
            {
                titleBgColor: '#FFFFFF',
                boldColor: '#c68411'
            }
        );

        await generator.loadTemplate('src/template.svg');
        await generator.generateCards('src/cards.csv', 'output');
        
        console.log('Cards generated successfully!');
    } catch (error) {
        console.error('Error generating cards:', error);
    }
}

if (require.main === module) {
    main();
}

export { CardGenerator, CardData, SVGSelectors, TextStyles };
