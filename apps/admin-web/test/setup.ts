// jsdom has no layout: the router's scroll restoration calls scrollTo.
window.scrollTo = () => undefined;
