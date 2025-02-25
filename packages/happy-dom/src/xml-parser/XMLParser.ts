import IDocument from '../nodes/document/IDocument.js';
import * as PropertySymbol from '../PropertySymbol.js';
import NamespaceURI from '../config/NamespaceURI.js';
import HTMLScriptElement from '../nodes/html-script-element/HTMLScriptElement.js';
import IElement from '../nodes/element/IElement.js';
import HTMLLinkElement from '../nodes/html-link-element/HTMLLinkElement.js';
import IDocumentType from '../nodes/document-type/IDocumentType.js';
import INode from '../nodes/node/INode.js';
import IDocumentFragment from '../nodes/document-fragment/IDocumentFragment.js';
import HTMLElementConfig from '../config/HTMLElementConfig.js';
import * as Entities from 'entities';
import HTMLElementConfigContentModelEnum from '../config/HTMLElementConfigContentModelEnum.js';

/**
 * Markup RegExp.
 *
 * Group 1: Beginning of start tag (e.g. "div" in "<div").
 * Group 2: End tag (e.g. "div" in "</div>").
 * Group 3: Comment with ending "--" (e.g. " Comment 1 " in "<!-- Comment 1 -->").
 * Group 4: Comment without ending "--" (e.g. " Comment 1 " in "<!-- Comment 1 >").
 * Group 5: Exclamation mark comment (e.g. "DOCTYPE html" in "<!DOCTYPE html>").
 * Group 6: Processing instruction (e.g. "xml version="1.0"?" in "<?xml version="1.0"?>").
 * Group 7: End of self closing start tag (e.g. "/>" in "<img/>").
 * Group 8: End of start tag (e.g. ">" in "<div>").
 */
const MARKUP_REGEXP =
	/<([a-zA-Z0-9-]+)|<\/([a-zA-Z0-9-]+)\s*>|<!--([^-]+)-->|<!--([^>]+)>|<!([^>]+)>|<\?([^>]+)>|(\/>)|(>)/gm;

/**
 * Attribute RegExp.
 *
 * Group 1: Attribute name when the attribute has a value using double apostrophe (e.g. "name" in "<div name="value">").
 * Group 2: Attribute value when the attribute has a value using double apostrophe (e.g. "value" in "<div name="value">").
 * Group 3: Attribute name when the attribute has a value using double apostrophe (e.g. "name" in "<div name="value">").
 * Group 4: Attribute value when the attribute has a value using double apostrophe (e.g. "value" in "<div name="value">").
 * Group 5: Attribute end apostrophe when the attribute has a value using double apostrophe (e.g. '"' in "<div name="value">").
 * Group 6: Attribute name when the attribute has a value using single apostrophe (e.g. "name" in "<div name='value'>").
 * Group 7: Attribute value when the attribute has a value using single apostrophe (e.g. "value" in "<div name='value'>").
 * Group 8: Attribute end apostrophe when the attribute has a value using single apostrophe (e.g. "'" in "<div name='value'>").
 * Group 9: Attribute name when the attribute has no value (e.g. "disabled" in "<div disabled>").
 */
const ATTRIBUTE_REGEXP =
	/\s*([a-zA-Z0-9-_:.$@?]+) *= *([a-zA-Z0-9-_:.$@?{}/]+)|\s*([a-zA-Z0-9-_:.$@?]+) *= *"([^"]*)("{0,1})|\s*([a-zA-Z0-9-_:.$@?]+) *= *'([^']*)('{0,1})|\s*([a-zA-Z0-9-_:.$@?]+)/gm;

enum MarkupReadStateEnum {
	startOrEndTag = 'startOrEndTag',
	insideStartTag = 'insideStartTag',
	plainTextContent = 'plainTextContent'
}

/**
 * Document type attribute RegExp.
 *
 * Group 1: Attribute value.
 */
const DOCUMENT_TYPE_ATTRIBUTE_REGEXP = /"([^"]+)"/gm;

/**
 * XML parser.
 *
 * @see https://html.spec.whatwg.org/multipage/indices.html
 */
export default class XMLParser {
	/**
	 * Parses XML/HTML and returns a root element.
	 *
	 * @param document Document.
	 * @param xml XML/HTML string.
	 * @param [options] Options.
	 * @param [options.rootNode] Node to append elements to. Otherwise a new DocumentFragment is created.
	 * @param [options.evaluateScripts = false] Set to "true" to enable script execution.
	 * @returns Root node.
	 */
	public static parse(
		document: IDocument,
		xml: string,
		options?: { rootNode?: IElement | IDocumentFragment | IDocument; evaluateScripts?: boolean }
	): IElement | IDocumentFragment | IDocument {
		const root = options && options.rootNode ? options.rootNode : document.createDocumentFragment();
		const stack: INode[] = [root];
		const stackTagNames: string[] = [];
		const markupRegexp = new RegExp(MARKUP_REGEXP, 'gm');
		const { evaluateScripts = false } = options || {};
		let currentNode: INode | null = root;
		let match: RegExpExecArray;
		let readState: MarkupReadStateEnum = MarkupReadStateEnum.startOrEndTag;
		let startTagIndex = 0;
		let lastIndex = 0;

		if (xml !== null && xml !== undefined) {
			xml = String(xml);

			while ((match = markupRegexp.exec(xml))) {
				switch (readState) {
					case MarkupReadStateEnum.startOrEndTag:
						if (
							match.index !== lastIndex &&
							(match[1] || match[2] || match[3] || match[4] || match[5] || match[6])
						) {
							// Plain text between tags.

							currentNode.appendChild(
								document.createTextNode(Entities.decodeHTML(xml.substring(lastIndex, match.index)))
							);
						}

						if (match[1]) {
							// Start tag.
							const tagName = match[1].toUpperCase();
							const localName = tagName === 'SVG' ? 'svg' : match[1];
							const config = HTMLElementConfig[localName];

							// Some elements are not allowed to be nested (e.g. "<a><a></a></a>" is not allowed.).
							// Therefore we need to auto-close the tag, so that it become valid (e.g. "<a></a><a></a>").
							if (
								config?.contentModel ===
									HTMLElementConfigContentModelEnum.noFirstLevelSelfDescendants &&
								stackTagNames[stackTagNames.length - 1] === tagName
							) {
								stack.pop();
								stackTagNames.pop();
								currentNode = stack[stack.length - 1] || root;
							} else if (
								config?.contentModel === HTMLElementConfigContentModelEnum.noSelfDescendants &&
								stackTagNames.includes(tagName)
							) {
								while (currentNode !== root) {
									if ((<IElement>currentNode)[PropertySymbol.tagName].toUpperCase() === tagName) {
										stack.pop();
										stackTagNames.pop();
										currentNode = stack[stack.length - 1] || root;
										break;
									}
									stack.pop();
									stackTagNames.pop();
									currentNode = stack[stack.length - 1] || root;
								}
							}

							// NamespaceURI is inherited from the parent element.
							// NamespaceURI should be SVG for SVGSVGElement.
							const namespaceURI =
								tagName === 'SVG'
									? NamespaceURI.svg
									: (<IElement>currentNode)[PropertySymbol.namespaceURI] || NamespaceURI.html;
							const newElement = document.createElementNS(namespaceURI, localName);

							currentNode.appendChild(newElement);
							currentNode = newElement;
							stack.push(currentNode);
							stackTagNames.push(tagName);
							readState = MarkupReadStateEnum.insideStartTag;
							startTagIndex = markupRegexp.lastIndex;
						} else if (match[2]) {
							// End tag.

							if (
								match[2].toUpperCase() ===
								(<IElement>currentNode)[PropertySymbol.tagName]?.toUpperCase()
							) {
								stack.pop();
								stackTagNames.pop();
								currentNode = stack[stack.length - 1] || root;
							}
						} else if (
							match[3] ||
							match[4] ||
							(match[6] &&
								(<IElement>currentNode)[PropertySymbol.namespaceURI] === NamespaceURI.html)
						) {
							// Comment.

							let comment: string;

							if (match[3]) {
								comment = match[3];
							} else if (match[4]) {
								comment = match[4].endsWith('--') ? match[4].slice(0, -2) : match[4];
							} else {
								comment = '?' + match[6];
							}

							currentNode.appendChild(document.createComment(Entities.decodeHTML(comment)));
						} else if (match[5]) {
							// Exclamation mark comment (usually <!DOCTYPE>).

							const exclamationComment = Entities.decodeHTML(match[5]);
							currentNode.appendChild(
								this.getDocumentTypeNode(document, exclamationComment) ||
									document.createComment(exclamationComment)
							);
						} else if (match[6]) {
							// Processing instruction (not supported by HTML).
							// TODO: Add support for processing instructions.
						} else {
							// Plain text between tags, including the match as it is not a valid start or end tag.

							currentNode.appendChild(
								document.createTextNode(
									Entities.decodeHTML(xml.substring(lastIndex, markupRegexp.lastIndex))
								)
							);
						}

						break;
					case MarkupReadStateEnum.insideStartTag:
						// End of start tag
						if (match[7] || match[8]) {
							// Attribute name and value.

							const attributeString = xml.substring(startTagIndex, match.index);
							let hasAttributeStringEnded = true;

							if (!!attributeString) {
								const attributeRegexp = new RegExp(ATTRIBUTE_REGEXP, 'gm');
								let attributeMatch: RegExpExecArray;

								while ((attributeMatch = attributeRegexp.exec(attributeString))) {
									if (
										(attributeMatch[1] && attributeMatch[2]) ||
										(attributeMatch[3] && attributeMatch[5] === '"') ||
										(attributeMatch[6] && attributeMatch[8] === "'") ||
										attributeMatch[9]
									) {
										// Valid attribute name and value.

										const name =
											attributeMatch[1] ||
											attributeMatch[3] ||
											attributeMatch[6] ||
											attributeMatch[9] ||
											'';
										const rawValue =
											attributeMatch[2] || attributeMatch[4] || attributeMatch[7] || '';
										const value = rawValue ? Entities.decodeHTMLAttribute(rawValue) : '';

										// In XML and SVG namespaces, the attribute "xmlns" should be set to the "http://www.w3.org/2000/xmlns/" namespace.
										const namespaceURI =
											(<IElement>currentNode)[PropertySymbol.namespaceURI] === NamespaceURI.svg &&
											name === 'xmlns'
												? NamespaceURI.xmlns
												: null;

										(<IElement>currentNode).setAttributeNS(namespaceURI, name, value);

										startTagIndex += attributeMatch[0].length;
									} else if (
										!attributeMatch[1] &&
										((attributeMatch[3] && !attributeMatch[5]) ||
											(attributeMatch[6] && !attributeMatch[8]))
									) {
										// End attribute apostrophe is missing (e.g. "attr='value" or 'attr="value').

										hasAttributeStringEnded = false;
										break;
									}
								}
							}

							// We need to check if the attribute string is read completely.
							// The attribute string can potentially contain "/>" or ">".
							if (hasAttributeStringEnded) {
								const config = HTMLElementConfig[(<IElement>currentNode)[PropertySymbol.localName]];

								// Checks if the tag is a self closing tag (ends with "/>") or void element.
								// When it is a self closing tag or void element it should be closed immediately.
								// Self closing tags are not allowed in the HTML namespace, but the parser should still allow it for void elements.
								// Self closing tags is supported in the SVG namespace.
								if (
									config?.contentModel === HTMLElementConfigContentModelEnum.noDescendants ||
									// SVG tag is self closing (<svg/>).
									(match[7] &&
										(<IElement>currentNode)[PropertySymbol.namespaceURI] === NamespaceURI.svg)
								) {
									stack.pop();
									stackTagNames.pop();
									currentNode = stack[stack.length - 1] || root;
									readState = MarkupReadStateEnum.startOrEndTag;
								} else {
									readState =
										config?.contentModel === HTMLElementConfigContentModelEnum.rawText
											? MarkupReadStateEnum.plainTextContent
											: MarkupReadStateEnum.startOrEndTag;
								}

								startTagIndex = markupRegexp.lastIndex;
							}
						}

						break;
					case MarkupReadStateEnum.plainTextContent:
						const tagName = currentNode[PropertySymbol.tagName];

						if (tagName && match[2] && match[2].toUpperCase() === tagName) {
							// End of plain text tag.

							// Scripts are not allowed to be executed when they are parsed using innerHTML, outerHTML, replaceWith() etc.
							// However, they are allowed to be executed when document.write() is used.
							// See: https://developer.mozilla.org/en-US/docs/Web/API/HTMLScriptElement
							if (tagName === 'SCRIPT') {
								(<HTMLScriptElement>currentNode)[PropertySymbol.evaluateScript] = evaluateScripts;
							} else if (tagName === 'LINK') {
								// An assumption that the same rule should be applied for the HTMLLinkElement is made here.
								(<HTMLLinkElement>currentNode)[PropertySymbol.evaluateCSS] = evaluateScripts;
							}

							// Plain text elements such as <script> and <style> should only contain text.
							currentNode.appendChild(
								document.createTextNode(
									Entities.decodeHTML(xml.substring(startTagIndex, match.index))
								)
							);

							stack.pop();
							stackTagNames.pop();
							currentNode = stack[stack.length - 1] || root;
							readState = MarkupReadStateEnum.startOrEndTag;
						}

						break;
				}

				lastIndex = markupRegexp.lastIndex;
			}

			if (lastIndex !== xml.length) {
				// Plain text after tags.

				currentNode.appendChild(
					document.createTextNode(Entities.decodeHTML(xml.substring(lastIndex)))
				);
			}
		}

		return root;
	}

	/**
	 * Returns document type node.
	 *
	 * @param document Document.
	 * @param value Value.
	 * @returns Document type node.
	 */
	private static getDocumentTypeNode(document: IDocument, value: string): IDocumentType {
		if (!value.toUpperCase().startsWith('DOCTYPE')) {
			return null;
		}

		const docTypeSplit = value.split(' ');

		if (docTypeSplit.length <= 1) {
			return null;
		}

		const docTypeString = docTypeSplit.slice(1).join(' ');
		const attributes = [];
		const attributeRegExp = new RegExp(DOCUMENT_TYPE_ATTRIBUTE_REGEXP, 'gm');
		const isPublic = docTypeString.toUpperCase().includes('PUBLIC');
		let attributeMatch;

		while ((attributeMatch = attributeRegExp.exec(docTypeString))) {
			attributes.push(attributeMatch[1]);
		}

		const publicId = isPublic ? attributes[0] || '' : '';
		const systemId = isPublic ? attributes[1] || '' : attributes[0] || '';

		return document.implementation.createDocumentType(
			docTypeSplit[1].toLowerCase(),
			publicId,
			systemId
		);
	}
}
