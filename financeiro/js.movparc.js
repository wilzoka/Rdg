$(function () {

    $(document).on('app-datatable', function (e, table) {

        switch (table) {
            case 'tableview89':
                $('button#' + table + '_insert').remove();
                $('button#' + table + '_delete').remove();
                break;
        }

    });

});