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

    private processTitle(title: string): string {
        return title.toUpperCase();
    }

    private processBacktext(text: string): { spans: Array<{ text: string, isBold: boolean }> } {
        const segments: Array<{ text: string, isBold: boolean }> = [];
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

        return { spans: segments };
    }

    private createSVGTextSpans($container: cheerio.Cheerio, 
                              segments: Array<{ text: string, isBold: boolean }>,
                              baseY: number): void {
        if (!this.$) throw new Error('Template not loaded');
        
        let currentX = 0;
        const lineHeight = 20;
        let currentY = baseY;
        let currentLine = '';
        const maxWidth = 280;

        segments.forEach(segment => {
            const words = segment.text.split(' ');
            
            words.forEach(word => {
                const wordWidth = word.length * 6;
                
                if (currentX + wordWidth > maxWidth) {
                    const $tspan = this.$!('<tspan>')
                        .attr('x', '0')
                        .attr('y', currentY.toString())
                        .text(currentLine.trim());
                    
                    $container.append($tspan);
                    
                    currentY += lineHeight;
                    currentLine = '';
                    currentX = 0;
                }
                
                currentLine += (currentX === 0 ? '' : ' ') + word;
                currentX += wordWidth + 6;
            });

            const $tspan = this.$!('<tspan>')
                .attr('x', '0')
                .attr('y', currentY.toString());
            
            if (segment.isBold) {
                $tspan.attr('fill', this.styles.boldColor)
                     .attr('font-weight', 'bold');
            }
            
            $tspan.text(currentLine.trim());
            $container.append($tspan);
            
            currentLine = '';
            currentX = 0;
            currentY += lineHeight;
        });
    }

    generateCard(data: CardData): string {
        if (!this.$) throw new Error('Template not loaded');
        
        const $ = load(this.template, { xmlMode: true });

        if (data.title) {
            const $titleElement = $(this.selectors.title);
            $titleElement.text(this.processTitle(data.title));
            $titleElement.attr('fill', this.styles.titleBgColor);
        }

        if (data.backtext) {
            const $backtextElement = $(this.selectors.backtext);
            const processedText = this.processBacktext(data.backtext);
            
            $backtextElement.empty();
            this.createSVGTextSpans($backtextElement, processedText.spans, 0);
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
