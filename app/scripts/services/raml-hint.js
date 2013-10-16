'use strict';

var CodeMirror = window.CodeMirror, suggestRAML = window.suggestRAML;

angular.module('raml')
  .factory('ramlHint', function () {
    var hinter = {};
    var WORD = /[\w$]+/;
    // TODO Unhardcode: Can't do neither cm.getOption('indentUnit')
    // nor editor.getOption('indentUnit') :(
    var indentUnit = 2;

    function extractKey(value) {
      return value.replace(new RegExp(':(.*)$', 'g'), '');
    }

    hinter.suggestRAML = suggestRAML;

    function indexAfterSpaces(s, i) {
      i = i || 0;
      while(i < s.length && s[i] === ' ') {
        i++;
      }

      return i;
    }

    function getEditorTextAsArrayOfLines(editor, limit) {
      var textAsList = [], i;

      for (i = limit; i > 0; i--) {
        textAsList.push(editor.getLine(i));
      }

      return textAsList;
    }

    hinter.computePath = function (editor) {
      var
          editorState = hinter.getEditorState(editor),
          line = editorState.cur.line, textAsList,
          tabSize = 2, lines;

      textAsList = getEditorTextAsArrayOfLines(editor, line);

      // It should have at least one element
      if (!textAsList.length) {
        return [];
      }

      lines = textAsList
      .map(function (lineContent) {
        var i = 0, result = {};

        i = indexAfterSpaces(lineContent);

        result.tabCount = i / tabSize;

        if (lineContent.slice(i).indexOf('- ') === 0) {
          result.isList = true;
          i++;
          i = indexAfterSpaces(lineContent, i);
        }

        lineContent = lineContent.slice(i).match(/(.+)(: |:\s*$)/);

        result.content = (lineContent && lineContent.length > 2) ?
          lineContent[1] : '';

        return result;
      });

      var result = lines.slice(1).reduce(function (state, lineData) {
        var prev = state[state.length - 1];

        // Ignore line if greater in tabs
        if (lineData.tabCount >= prev.tabCount) {
          return state;
        } else if (lineData.tabCount === prev.tabCount - 1) {
          if (lineData.isList) {
            prev.isList = true;
            return state;
          }
        }

        state.push(lineData);

        return state;
      }, [lines[0]]);

      result = result.slice(1).reduce(function (state, lineData) {
        if (state.path[0].tabCount > lineData.tabCount + 1 ) {
          if (!state.path[0].isList && !lineData.isList) {
            state.invalid = true;
          }
        }
        state.path.unshift(lineData);
        return state;
      }, {invalid: false, path: [result[0]]});

      var l = result.path.map(function (e) {
        return e.content;
      });

      return result.invalid ? undefined : l;
    };

    hinter.createIndentation = function createIndentation (tabCount) {
      var s = new Array(indentUnit + 1).join(' ');
      var result = '';
      for (var i = 0; i < tabCount; i++) {
        result += s;
      }
      return result;
    };

    hinter.getPadding = function getPadding(node, tabCount) {
      if (!node || !node.constructor || !node.constructor.name) {
        throw new Error('Can\'t determine padding for node: ' + node);
      }

      if ('StringWildcard' === node.constructor.name) {
        return ' ';
      }

      return '\n' + hinter.createIndentation(tabCount);
    };

    hinter.getEditorState = function(editor, options) {
      var word = options && options.word || WORD;
      var cur = editor.getCursor(), curLine = editor.getLine(cur.line);
      var startPos = cur.ch, endPos = startPos;

      var currLineTabCount = 0;
      var curLineSpaces = curLine.match(/^\s+/);
      if(curLineSpaces) {
        currLineTabCount = Math.floor(curLineSpaces[0].length / indentUnit);
      }

      while (endPos < curLine.length && word.test(curLine.charAt(endPos))) {
        ++endPos;
      }
      while (startPos && word.test(curLine.charAt(startPos - 1))) {
        --startPos;
      }

      var start = CodeMirror.Pos(cur.line, startPos),
      end = CodeMirror.Pos(cur.line, endPos);
      return {
        curWord: startPos !== endPos && curLine.slice(startPos, endPos),
        start: start,
        end: end,
        cur: cur,
        curLine: curLine,
        currLineTabCount: currLineTabCount
      };
    };

    hinter.getScopes = function (editor) {
      var
        total = editor.lineCount(), i, line,
        zipValues = [], currentIndexes = {}, lineWithoutTabs, tabCount,
        spacesCount;
      for (i = 0; i < total; i++) {
        line = editor.getLine(i);
        spacesCount = indexAfterSpaces(line);
        tabCount = Math.floor(spacesCount / indentUnit);
        lineWithoutTabs = line.slice(spacesCount);

        zipValues.push([tabCount, lineWithoutTabs, i]);
      }

      var levelTable = zipValues.reduce(function (x,y) {
        var currentArray = currentIndexes[y[0] - 1],
          lastArrayIndex, currentIndex;

        if (currentArray) {
          lastArrayIndex = currentArray.length - 1;
          currentIndex = currentIndexes[y[0] - 1][lastArrayIndex];
        } else if (y[0] > 1) {
          // Case for lists, we fetch a level lower
          currentArray = currentIndexes[y[0] - 2];
          lastArrayIndex = currentArray.length - 1;
          currentIndex = currentIndexes[y[0] - 2][lastArrayIndex];

          x[currentIndex] = x[currentIndex] || [];
          x[currentIndex].push([y[2], y[1]]);

          currentIndexes[y[0] - 1] = currentIndexes[y[0] - 1] || [];
          currentIndexes[y[0] - 1].push(y[2]);
          return x;
        } else {
          // Case of the first element of the first level
          currentIndex = 0;
        }

        x[currentIndex] = x[currentIndex] || [];
        x[currentIndex].push([y[2], y[1]]);

        currentIndexes[y[0]] = currentIndexes[y[0]] || [];
        currentIndexes[y[0]].push(y[2]);
        return x;
      }, {});

      return {scopeLevels: currentIndexes, scopesByLine: levelTable};
    };



    function extractKeyPartFromScopes(scopesInfo) {
      return (scopesInfo || []).map(function (scopeInfo) {
        return extractKey(scopeInfo[1]);
      });
    }

    hinter.getKeysToErase = function (editor) {
      var editorState = hinter.getEditorState(editor),
          scopes = hinter.getScopes(editor),
          currentLineNumber = editorState.cur.line,
          currentScopeLevel = editorState.currLineTabCount;

      if (currentScopeLevel !== 0) {
        var scopesAtLevel = scopes.scopeLevels[currentScopeLevel - 1] || [];

        // We get the maximal element of the set of less than number of line
        var numOfLinesOfParentScopes = scopesAtLevel.filter(function (numOfLine) {
          return numOfLine < currentLineNumber;
        });

        var scopeLineInformation = scopes.scopesByLine[
          numOfLinesOfParentScopes[numOfLinesOfParentScopes.length - 1]
        ];

        return extractKeyPartFromScopes(scopeLineInformation);
      } else {
        return extractKeyPartFromScopes(scopes.scopesByLine[0]);
      }
    };

    hinter.selectiveCloneAlternatives = function (oldAlternatives, keysToErase) {
      var newAlternatives = {}, newAlternativesSuggestions = {};

      Object.keys(oldAlternatives.suggestions || []).forEach(function (key) {
        if (keysToErase.indexOf(key) === -1) {
          newAlternativesSuggestions[key] = oldAlternatives.suggestions[key];
        }
      });

      Object.keys(oldAlternatives).forEach(function(key) {
        newAlternatives[key] = oldAlternatives[key];
      });

      newAlternatives.suggestions = newAlternativesSuggestions;

      newAlternatives.isOpenSuggestion = oldAlternatives.constructor.name === 'OpenSuggestion';

      return newAlternatives;

    };

    hinter.getAlternatives = function (editor) {
      var val = hinter.computePath(editor), alternatives,
        keysToErase, alternativeKeys = [];

      // Invalid tabulation detected :)
      if ( !val ) {
        return {values: {}, keys: [], path: []};
      }

      val.pop();

      alternatives = hinter.suggestRAML(val);

      keysToErase = hinter.getKeysToErase(editor);

      alternatives = hinter.selectiveCloneAlternatives(alternatives, keysToErase);

      if (alternatives && alternatives.suggestions) {
        alternativeKeys = Object.keys(alternatives.suggestions);
      }

      return {values: alternatives, keys: alternativeKeys, path: val};
    };

    hinter.getSuggestions = function (editor) {
      var alternatives = hinter.getAlternatives(editor);

      var list = alternatives.keys.map(function (e) {
        var suggestion = alternatives.values.suggestions[e];
        return { name: e, category: suggestion.metadata.category };
      }) || [];

      if (alternatives.values.metadata && alternatives.values.metadata.id === 'resource') {
        list.push({name: 'New resource', category: alternatives.values.metadata.category});
      }

      list.path = alternatives.path;

      return list;
    };

    hinter.autocompleteHelper = function(editor) {
      var editorState = hinter.getEditorState(editor),
          curWord = editorState.curWord,
          start = editorState.start,
          end = editorState.end,
          alternatives = hinter.getAlternatives(editor),
          list;

      list = alternatives.keys.map(function (e) {
          var suggestion = alternatives.values.suggestions[e],
              text = e + ':';

          return {
              text: text,
              displayText: text,
              category: suggestion.metadata.category,
              render: function (element, self, data) {
                element.innerHTML = '<div>' + data.displayText + '</div>' +
                  '<div class="category">' + data.category + '</div>';
              }
            };
        }).filter(function (e) {
          if (curWord) {
            return e && e.text.indexOf(curWord) === 0;
          }

          return true;
        }) || [];

      return {list: list, from: start, to: end};
    };

    return hinter;
  });
