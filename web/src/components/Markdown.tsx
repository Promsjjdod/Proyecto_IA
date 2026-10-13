import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import { textFromCodeChildren } from '../artifacts';

export function Markdown({ content }: { content: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard may be disabled in insecure contexts */ }
  };
  return <div className="markdown-body">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
      pre({ children, ...props }) {
        const child = Array.isArray(children) ? children[0] : children;
        const codeNode = child && typeof child === 'object' && 'props' in child ? child : null;
        const text = textFromCodeChildren(codeNode?.props && typeof codeNode.props === 'object' && 'children' in codeNode.props ? codeNode.props.children : '');
        const className = codeNode?.props && typeof codeNode.props === 'object' && 'className' in codeNode.props && typeof codeNode.props.className === 'string' ? codeNode.props.className : '';
        const language = className.match(/language-([\w-]+)/)?.[1] || 'code';
        return <div className="code-block">
          <div className="code-block-head"><span>{language}</span><button onClick={() => void copy(text)} className="icon-text-button" aria-label="Copiar código">{copied === text ? <Check size={14} /> : <Copy size={14} />}{copied === text ? 'Copiado' : 'Copiar'}</button></div>
          <pre {...props}>{children}</pre>
        </div>;
      },
      a({ href, children, ...props }) { return <a href={href} target="_blank" rel="noreferrer noopener" {...props}>{children}</a>; },
      code({ className, children, ...props }) { return <code className={className} {...props}>{children}</code>; },
    }}>{content}</ReactMarkdown>
  </div>;
}
